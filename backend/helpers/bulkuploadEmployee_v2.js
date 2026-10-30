const db = require('../models/indexSQL.js')
const {
    DBinsertSendID,
    DBinsertSendResponse,
    DBUpdate
} = require('../queries/commonQueries')
const csv = require('csvtojson')
const Constants = require('../utils/constant')
const multer = require('multer')
const axios = require('axios')
const validators = require('../helpers/validators')
const { computeDestinationPoint } = require('geolib')
const { columns } = require('../models/indexSQL.js')
const configOptions = require('../config.js')
const onboardURL = (configOptions.env == 'prod') ? 'https://fieldworkeronboardprod.azurewebsites.net/api/fieldworker/onboard/initaddEmployee' : 
(configOptions.env == 'test') ? 'https://fieldworkeronboard.azurewebsites.net/api/fieldworker/onboard/initaddEmployee' : 
'https://fwonboardapp.azurewebsites.net/api/fieldworker/onboard/initaddEmployee'
var {SEGMENT_API_KEY} = require("../config");
const { Analytics } = require('@segment/analytics-node')
const analytics = new Analytics({ writeKey: SEGMENT_API_KEY })


exports.bulkImportEmployees = async function (req, res) {
    let fileData = await readFileData(req, res)
    console.log(fileData)
    if(!!fileData.errors){
        res.status(500).json({errors: fileData.errors})
        return;
    }
    
    let validEmployees = []
    let invalidEmployees = []
    const company_name = await DBinsertAndSelectResponse(`select com_name from company where com_id=${req.query.company_id}`)

    for(let i = 0; i < fileData.length; i++){
        if(validators.isValidRequiredInput(fileData[i].Email) && validators.isValidRequiredInput(fileData[i]['Employee First Name']) && validators.isValidRequiredInput(fileData[i]['Employee Last Name'])){
            console.log(fileData[i])
            console.log(req.query.company_id)
            let processedEmployee = await processEmployee(fileData[i], req.query.company_id, company_name, false, null)
            if(validators.isValidInput(processedEmployee.errors)){
                invalidEmployees.push(processedEmployee)
            } else {
                validEmployees.push(processedEmployee)
            }
        } else {
            fileData[i].errors = [`Employee is missing email OR Employee First Name OR Employee Last Name`]
            invalidEmployees.push(fileData[i])
        }
    }

    let com_id = req.query.company_id, emp_id = req.query.emp_id;
    if (com_id && emp_id) {
        analytics.track({
          userId: String(emp_id),
          event: 'Employee Import file uploaded',
          context: {
            groupId: com_id,
          },
          properties: {
            success: validEmployees,
            failure: invalidEmployees,
          }
        })
        console.log("logged to segment successfully")
    }
    
    res.status(200).json({
        code: 200,
        message: 'Employee Import Completed',
        results: {
            success: validEmployees,
            failure: invalidEmployees,
        },
    })

    return;
}

async function readFileData(req, res) {
    try {
        if (!req.file) {
            return {error: `File not present or missed while uploading`}
        } else if (req.file.mimetype.substr(req.file.mimetype.length - 4, 3).toLowerCase() == 'csv'.toLowerCase()) {
            return {error: `File is not a CSV`}
        }
        const jsonArray = await csv().fromString(req.file.buffer.toString('utf8'))
        return jsonArray
    } catch (err) {
        console.log(`| ERROR | Could not process Employee Bulk Import CSV`)
        console.log(err)
        return {error: `An Unknown error occured while trying to process the CSV File`}
    }
}

async function processEmployee(employeeData, com_id, company_name, isUpdate, emp_id) {
    try{
        const employee = {
            //emp_id
            emp_first_name: employeeData['Employee First Name'],
            emp_last_name: employeeData['Employee Last Name'],
            address_line1: employeeData['Address Line 1'],
            address_line2: employeeData['Address Line 2'],
            city: employeeData['City'],
            state: employeeData['State'],
            zip: employeeData['Zip'],
            emp_phone_number: validators.getPhone(employeeData['Phone']),
            // Join Date
            emp_status: employeeData['Status'],
            emp_type: employeeData['Type'],
            emp_level: employeeData['Level'],
            emp_vacation: employeeData['Vacation Days'],
            emp_personal: employeeData['Personal Days'],
            //emp_is_admin
            //emp_is_project_manager
            emp_is_active: employeeData['Active'],
            //created at
            //updated at
            employee_manager_id: employeeData['Employee Manager ID'],
            comp_id: com_id,
            //empEmail
            email: employeeData['Email'],
            //emp_designation
            home_phone: validators.getPhone(employeeData['Home Phone']),
            ssn: employeeData['SSN'],
            dob: employeeData['Date of Birth'],
            //date_of_termination
            //termination_reason
            compensation_type: employeeData['Compensation Type'],
            compensation_rate: employeeData['Compensation Rate'],
            //emp_doxylink
            emp_gender: employeeData['Gender'],
            emp_stateRegistraionID: employeeData['State Registration ID'],
            emp_stateRegistraionType: employeeData['State Registration Type'],
            //emp_professionalLicenseNumber
            emp_local_id: employeeData['Employee Local ID'],
    
            user_name: employeeData.user_name,
        }
        
        console.log("DEBUG #15")
        console.log(employee)

        if (isUpdate) {
            return await updateOneEmployee(employee, com_id, emp_id)
        } else {
            let onBoardResponse = await onBoarding(employee, com_id, company_name)
            return {...employee, ...onBoardResponse}
        }
    } catch(err){ 
        console.log(err)
        emplyeeData.errors = ['Error Occured While Processing Employee Data']
        return emplyeeData;
    }
}

async function onBoarding(emp, com_id, company_name) {
    try {
        let onboardResponse = await axios.post(onboardURL, {
            comp_id: com_id,
            company_name: company_name,
            user_name: emp.user_name,
            first_name: emp.emp_first_name,
            last_name: emp.emp_last_name,
            employee_email: emp.email,
            emp_phone_number:emp.emp_phone_number,
            address:emp.address,
            compensation_rate:emp.compensation_rate,
            compensation_type:emp.compensation_type,
            dob:emp.dob,
            emp_gender:emp.emp_gender,
            emp_is_active:emp.emp_is_active,
            emp_local_id:emp.emp_local_id,
            emp_personal:emp.emp_personal,
            emp_stateRegistraionID:emp.emp_stateRegistraionID,
            emp_stateRegistraionType:emp.emp_stateRegistraionType,
            emp_status:emp.emp_status,
            emp_type:emp.emp_type,
            emp_vacation:emp.emp_vacation,
            home_phone:emp.home_phone,
            ssn:emp.ssn,
            emp_level:emp.emp_level,
            employment_status:emp.employment_status,
            address_line1:emp.address_line1,
            address_line2:emp.address_line2,
            city:emp.city,
            state:emp.state,
            zip:emp.zip
        })
        console.log(com_id)
        console.log(emp.email)
        console.log(emp.emp_first_name)
        console.log(emp.emp_last_name)
        if (!!onboardResponse) {
            // return {emp_id : onboardResponse.data.id}
            return onboardResponse.data;
        }

    } catch (e) {
        console.log(e)
        return null
    }
}

async function getEmployeeByEmail(emp_email, comp_id) {
    const query = `SELECT emp_id FROM employee where sec_email = '${emp_email}' and emp_is_active = 'true' and emp_company_id=${comp_id}`
    const result = await DBinsertAndSelectResponse(query)
    return result
}


async function updateOneEmployee(emp, com_id, emp_id) {
    //removed the empEamil update - do not update the email in the employee
    //const query = `UPDATE employee SET emp_first_name='${emp.emp_first_name}',emp_last_name='${emp.emp_last_name}',emp_phone_number='${emp.sc_agency_phone}',emp_updated_at=CURRENT_TIMESTAMP,emp_company_id=${com_id} WHERE emp_id = ${emp_id}`
    try{
        const query = `UPDATE employee
        SET emp_first_name=${!!emp.emp_first_name ? '\'' + emp.emp_first_name + '\'' : 'NULL'},
        emp_last_name=${!!emp.emp_last_name ? '\'' + emp.emp_last_name + '\'' : 'NULL'},
        emp_local_id=${!!emp.emp_local_id ? '\'' + emp.emp_local_id + '\'' : 'NULL'},
        emp_updated_at=CURRENT_TIMESTAMP,
        ssn=${!!emp.ssn ? '\'' + emp.ssn + '\'' : 'NULL'},
        dob=${!!emp.dob ? '\'' + emp.dob + '\'' : 'NULL'},
        emp_gender=${!!emp.emp_gender ? '\'' + emp.emp_gender + '\'' : '\'Other\''},
        compensation_type=${!!emp.compensation_type ? '\'' + emp.compensation_type + '\'' : 'NULL'},
        compensation_rate=${!!emp.compensation_rate ? emp.compensation_rate : 'NULL'},
        emp_stateRegistraionID=${!!emp.emp_stateRegistraionID ? emp.emp_stateRegistraionID : 'NULL'},
        emp_stateRegistraionType=${!!emp.emp_stateRegistraionType ? '\'' + emp.emp_stateRegistraionType + '\'' : 'NULL'},
        home_phone=${!!emp.home_phone ? emp.home_phone : 'NULL'},
        emp_addr_line1=${!!emp.address_line1 ? '\'' + emp.address_line1 + '\'' : 'NULL'},
        emp_addr_line2=${!!emp.address_line2 ? '\'' + emp.address_line2 + '\'' : 'NULL'},
        emp_city=${!!emp.city ? '\'' + emp.city + '\'' : 'NULL'},
        emp_state=${!!emp.state ? '\'' + emp.state + '\'' : 'NULL'},
        emp_zip=${!!emp.zip ? emp.zip : 'NULL'},
        emp_phone_number=${!!emp.emp_phone_number ? emp.emp_phone_number : 'NULL'},
        emp_status=${!!emp.emp_status ? '\'' + emp.emp_status + '\'' : '\'Active\''},
        emp_type=${!!emp.emp_type ? '\'' + emp.emp_type + '\'' : '\'Support Coordinator\''},
        emp_vacation=${!!emp.emp_vacation ? emp.emp_vacation : 'NULL'},
        emp_personal=${!!emp.emp_personal ? emp.emp_personal : 'NULL'},
        emp_is_active=${!!emp.emp_is_active ? '\'' + emp.emp_is_active + '\'' : 1},
        emp_company_id=${com_id} WHERE emp_id = ${emp_id}`
        
        console.log(query)
    
        return await DBUpdate(query)
    }
    catch(e)
    {
        console.log(e)
        return({employeeData: {}, errors: ['Error occured when attempting to update employee']})
    }
}

async function DBinsertAndSelectResponse(query) {
    const request = new db.Request()
    let res = await request.query(query).then((result) => {
        return result
    }).catch((err) => {
        console.log(err)
        return null;
    })
    return !res ? null : res.recordset[0]
}