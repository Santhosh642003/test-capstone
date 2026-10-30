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
const BING_API_KEY = require('../config.js')

exports.readAndDumpFileData = function (req, res) {
    readFileData(req, res)
}

async function readFileData(req, res) {
    const dateActualStart = new Date()
    /* Creating constant/ENUM for making good standard for get map values
      WIll do this later
      console.log("ConstantUtils.DDD_ID");
      console.log(Constants.DDD_ID);
      */
    /*
      Check if file exist  and in else if check if its with extensnsion csv
      (With not matching condition return response)
      */
    // console.log('from where ?',req)
    try {
        const com_id = req.query.comp_id
        const user_name = req.query.user_name
        
        const query = `select com_name from company where com_id=${com_id}`
        const company_name = await DBinsertAndSelectResponse(query)
       

        if (!req.files) {
            res.json({
                code: 500,
                message: 'File not present or missed while uploading'
            })
            return
        } else if (req.files.filecontent.name.substr(req.files.filecontent.name.length - 4, 3).toLowerCase() == 'csv'.toLowerCase()) {
            res.json({
                code: 500,
                message: 'File is Not a CSV file'
            })
            return
        }

        const jsonArray = await csv().fromString(req.files.filecontent.data.toString('utf8'))

        const retlist = []
        // for (var i = 0; i < 3; i++) {
        for (let i = 0; i < jsonArray.length; i++) {
            const retObj = {}
            let caseType
            const obj = jsonArray[i]

            // console.log('Where am i',com_id,!!obj['DDD ID'], !!obj['Active Plan Version'], obj['SC E-mail'])
            if (!!com_id && !!obj['Email']) {
                let emp_id
                try {
                    // Check If Emp Exist
                    emp_id = await getEmployeeByEmail(obj['Email'], com_id)
                    // console.log(emp_id.emp_id + " Hello")
                    if (!emp_id || !emp_id.emp_id) {
                        emp_id = await readAndDumpEmp({ ...obj, user_name: req.query.user_name }, com_id,company_name.com_name, false, null)
                        caseType = '0'
                    } else {
                        // existing employee then update
                        await readAndDumpEmp(obj, com_id,company_name, true, emp_id.emp_id)
                        caseType = '1'
                    }
                } catch (_) {
                    caseType = '2'
                }
                retObj.EmpName = obj['Name']
                retObj.caseType = caseType

                retlist.push(caseType)

            } else {
                retObj.EmpName = ''
                retObj.caseType = 'X'
                caseType = 'X'
                retlist.push(caseType)
            }
        }
        var dateActualEnd = new Date()
        res.json({
            code: 200,
            message: retlist,
            timeTaken: dateActualEnd - dateActualStart
        })
    } catch (err) {
        console.log(err)
        res.json({
            code: 500,
            message: 'Something went Wrong On Server(Company Id was not Present)',
            timeTaken: dateActualEnd - dateActualStart
        })
    }
}

async function readAndDumpEmp(obj, com_id,company_name, isUpdate, emp_id) {

    const name = await validators.getName(obj['Name']).split(' ')

    const addr = validators.getAddress(obj['Address'])

    const employee = {
        email: obj['Email'],
        emp_phone_number: await validators.getPhone(obj['Contact Phone']),
        ssn:obj['SSN'],
        dob: obj['Date of Birth'],
        emp_type:obj['Type'],
        emp_first_name: name[0],
        emp_last_name: name[name.length - 1],
        emp_is_active:obj['Active'],
        emp_vacation:obj['Vacation Days'],
        emp_personal:obj['Personal Days'],
        home_phone:obj['Home Phone'],
        compensation_type:obj['Compensation Type'],
        compensation_rate:obj['Compensation Rate'],
        emp_status:obj['Status'],
        employment_status:obj['Employment Status'],
        emp_gender:obj['Gender'],
        emp_stateRegistraionID:obj['State Registration ID'],
        emp_stateRegistraionType:obj['State Registration Type'],
        emp_local_id:obj['Employee Local ID'],
        user_name:obj.user_name,
        emp_level:obj['Level'],
        address_line1:addr.address_line1,
        address_line2:addr.address_line2,
        city:addr.city,
        state:addr.state,
        zip:addr.zip
        
    }



    if (isUpdate) {
        console.log("Hello")
        return await updateOneEmployee(employee, com_id, emp_id)
    } else {
        // return await addEmployee(employee, com_id)
        return await onBoarding(employee, com_id,company_name)
    }
}

async function onBoarding(emp, com_id,company_name) {

    try {
        let obj = await axios.post('https://fwonboardapp.azurewebsites.net/api/fieldworker/onboard/initaddEmployee', {
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
        // let obj = await axios.post('http://localhost:5000/api/fieldworker/onboard/initaddEmployee', {
        //     comp_id: com_id,
        //     company_name: company_name,
        //     user_name: emp.user_name,
        //     first_name: emp.emp_first_name,
        //     last_name: emp.emp_last_name,
        //     employee_email: emp.email,
        //     emp_phone_number:emp.emp_phone_number,
        //     address:emp.address,
        //     compensation_rate:emp.compensation_rate,
        //     compensation_type:emp.compensation_type,
        //     dob:emp.dob,
        //     emp_gender:emp.emp_gender,
        //     emp_is_active:emp.emp_is_active,
        //     emp_local_id:emp.emp_local_id,
        //     emp_personal:emp.emp_personal,
        //     emp_stateRegistraionID:emp.emp_stateRegistraionID,
        //     emp_stateRegistraionType:emp.emp_stateRegistraionType,
        //     emp_status:emp.emp_status,
        //     emp_type:emp.emp_type,
        //     emp_vacation:emp.emp_vacation,
        //     home_phone:emp.home_phone,
        //     ssn:emp.ssn,
        //     emp_level:emp.emp_level,
        //     employment_status:emp.employment_status,
        //     address_line1:emp.address_line1,
        //     address_line2:emp.address_line2,
        //     city:emp.city,
        //     state:emp.state,
        //     zip:emp.zip
        // })

        if (!!obj) {
            // return {emp_id : obj.data.id}
            return { '': obj.data.id }

        }

    } catch (e) {
        console.log(e)
        return null
    }

    // return axios.post('https://fwonboardapp.azurewebsites.net/api/fieldworker/onboard/initaddEmployee', {
    //   comp_id: com_id,
    //   company_name: "Field Worker",
    //   user_name: emp.sc,
    //   first_name: emp.sc.split(' ')[0],
    //   last_name: emp.sc.split(' ')[1],
    //   employee_email: emp.sc_email,
    // })
    // .then(function (response) {
    //   console.log(response);
    // })
    // .catch(function (error) {
    //   console.log(error);
    // });

}

// async function addEmployee (emp, com_id) {

//   const query = 'insert into employee' +
//         '(emp_first_name,emp_last_name,emp_addr_line1,emp_addr_line2,' +
//         ' emp_city,emp_state,emp_zip,emp_phone_number,sec_email,emp_designation,emp_join_date,emp_status,' +
//         'emp_type,emp_level,emp_doxylink,emp_vacation,emp_personal,emp_is_admin,emp_is_project_manager,' +
//         'emp_is_active,emp_created_at,emp_updated_at,' +
//         'emp_manager_id,emp_company_id)' +
//         'values(' +
//         "'" + (emp.sc ? emp.sc.split(' ')[0] : '') + "'," +
//         "'" + (emp.sc ? emp.sc.split(' ')[1] : '') + "'," +
//         "'" + (emp.address1 ? emp.address1 : '') + "'," +
//         "'" + (emp.address2 ? emp.address2 : '') + "'," +
//         "'" + (emp.city ? emp.city : '') + "'," +
//         "'" + (emp.state ? emp.state : '') + "'," +
//         "'" + (emp.zip ? emp.zip : '') + "'," +
//         "'" + (emp.phoneList ? emp.phoneList : '') + "'," +
//         "'" + (emp.sc_email ? emp.sc_email : '') + "'," +
//         "'Support Co-ordinator'," +
//         (emp.join_date ? "'" : '') + (!emp.join_date ? 'CURRENT_TIMESTAMP' : emp.join_date) + (emp.join_date ? "'," : ',') +
//         "'" + (emp.status ? emp.status : '') + "'," +
//         "'" + (emp.employee_type ? emp.employee_type : 'Support Coordinator') + "'," +
//         "'" + (emp.employee_level ? emp.employee_level : '') + "'," +
//         "'" + (emp.employee_doxy_link ? emp.employee_doxy_link : '') + "'," +
//         '' + (emp.vacation_days ? emp.vacation_days : 'NULL') + ',' +
//         '' + (emp.personal_days_off ? emp.personal_days_off : 'NULL') + ',' +
//         "'false'," +
//         "'false'," +
//         "'true'," +
//         'CURRENT_TIMESTAMP,' +
//         'NULL,' +
//         '' + (emp.manager ? emp.manager : 'NULL') + ',' +
//         '' + (com_id || 'NULL') + '); SELECT SCOPE_IDENTITY();'

//   let emp_id = await DBinsertAndSelectResponse(query)
//   console.log(emp_id + "line 263")
//   return emp_id
// }


async function getEmployeeByEmail(emp_email, comp_id) {
    const query = `SELECT emp_id FROM employee where sec_email = '${emp_email}' and emp_is_active = 'true' and emp_company_id=${comp_id}`
    const result = await DBinsertAndSelectResponse(query)
    return result
}


async function updateOneEmployee(emp, com_id, emp_id) {
    //removed the empEamil update - do not update the email in the employee
    //const query = `UPDATE employee SET emp_first_name='${emp.emp_first_name}',emp_last_name='${emp.emp_last_name}',emp_phone_number='${emp.sc_agency_phone}',emp_updated_at=CURRENT_TIMESTAMP,emp_company_id=${com_id} WHERE emp_id = ${emp_id}`
    try{
    const query = `UPDATE employee SET emp_first_name='${emp.emp_first_name}',emp_last_name='${emp.emp_last_name}',emp_local_id='${emp.emp_local_id}',emp_updated_at=CURRENT_TIMESTAMP,ssn='${emp.ssn}',
    dob='${emp.dob}',emp_gender='${emp.emp_gender}',compensation_type='${emp.compensation_type}',compensation_rate=${emp.compensation_rate},emp_stateRegistraionID=${emp.emp_stateRegistraionID},
    emp_stateRegistraionType='${emp.emp_stateRegistraionType}',home_phone=${emp.home_phone},emp_addr_line1='${emp.address_line1}',emp_addr_line2='${emp.address_line2}',emp_city='${emp.city}',emp_state='${emp.state}',
    emp_zip=${emp.zip},emp_phone_number=${emp.emp_phone_number},emp_status='${emp.emp_status}',emp_type='${emp.emp_type}',emp_vacation=${emp.emp_vacation},emp_personal=${emp.emp_personal},emp_is_active='${emp.emp_is_active}',
    emp_company_id=${com_id} WHERE emp_id = ${emp_id}`
    
    console.log(query)
   
    return await DBUpdate(query)
    }
    catch(e)
    {
        console.log(e)
    }
}

async function DBinsertAndSelectResponse(query) {
    console.log(query + " dbinsertandselect")
    const request = new db.Request()
    let res = await request.query(query).then((result) => {
        return result
    }).catch((err) => {
        console.log(err)
        return null;
    })
    return !res ? null : res.recordset[0]
}