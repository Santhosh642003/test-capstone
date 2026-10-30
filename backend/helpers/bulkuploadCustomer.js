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

exports.readAndDumpFileData = async (req, res) => {
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
            if (!!com_id && !!obj['DDD ID']) {
                let cus_id
                let loc_id

                try {
                    // Check if customer present with DDD_ID
                    cus_id = await getCustomerByDDD(obj['DDD ID'], com_id)
                    if (!cus_id || !cus_id.cus_id) {
                        // Add Customer  and check project and add emp id to customer tablr from upper table
                        cus_id = await readAndDumpCust(obj, com_id, false, null)
                        loc_id = cus_id.locArrId
                        caseType = '0'
                    } else {
                        const res = await readAndDumpCust(obj, com_id, true, cus_id.cus_id)
                        loc_id = res.locArrId
                        caseType = '1'
                        // Existing customer then update
                    }
                } catch (_) {
                    caseType = '2'
                }
                retObj.custName = obj.Name
                // Cust done here
                // try {
                //     // check if project ava with cust id and active plan version
                //     let pro_id = await getProjectId(obj['DDD ID'], obj['Active Plan Version'], com_id)
                //     cus_id = await getCustomerByDDD(obj['DDD ID'], com_id)
                //     let con_id = await getContactId(com_id, cus_id.cus_id)
                //     if (!pro_id || !!pro_id['']) {
                //         // Add Project with taking cust id
                //         pro_id = await readAndDumpProj(obj, !cus_id[''] ? cus_id.cus_id : cus_id[''], com_id, false, null, loc_id, con_id)
                //         caseType = caseType + '0'
                //     } else {
                //         // Existing Project with current customer then update and assign emp in project
                //         await readAndDumpProj(obj, !cus_id[''] ? cus_id.cus_id : cus_id[''], com_id, true, pro_id.pro_id, loc_id, con_id)
                //         caseType = caseType + '1'
                //     }
                // } catch (err) {
                //     caseType = caseType + '2'
                // }
                //retObj.projName = obj['Active Plan Version']
                retObj.caseType = caseType
                console.log(caseType + " CaseType")
                retlist.push(caseType)
            }
            else {
                retObj.custName = ''
                retObj.projName = ''
                retObj.caseType = 'XX'
                caseType = 'XX'
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

// Customer Operations Starts here
async function readAndDumpCust(obj, com_id, isUpdate, cust_id,) {
    // const addr = await splitAddr(obj.Address)
    //const addr = validators.getAddress(obj['Address'])
    // const contact_phone = await validatePhone(obj['Contact Phone'])
    const cust = {
        ddd_id: await validators.getNumber(obj['DDD ID']),
        name: await validators.getName(obj.Name),
        waiver_prgm: await validators.getText(obj['Waiver Program']),
        sc_agency: await validators.getText(obj['SC Agency']),
        address: obj.Address,
        age: obj.Age,
        phone: await validators.getPhone(obj['Contact Phone']),
        dob: obj['Date of Birth'],
        email: obj['E-mail'],
        status: obj.Status,
        cus_status: 'Active',
        county: obj.County,
        due_date: obj['Due Date'],
        func_criteria_met: obj['Functional Criteria Met'],
        gender: obj.Gender,
        last_assess_date: obj['Last Assessment Date'],
        medicaid_eligible: obj['Medicaid Eligibility'],
        medicaid_end_date: obj['Medicaid End Date'],
        medicaid_id: obj['Medicaid ID'],
        company_id: com_id,
        is_company: 'False',
        cus_local_id: obj['Customer Local Id']
    }

    if (isUpdate) {
        return await updateOneCustomer(cust, com_id, cust_id)
    } else {
        return await addCustomer(cust)
    }
}

async function readAndDumpProj(obj, cus_id, com_id, isUpdate, pro_id, loc_id, con_id) {

    const proj = {
        ddd_id: await validators.getNumber(obj['DDD ID']),
        customer_name: await validators.getName(obj['Name']),
        waiver_prgm: obj['Waiver Program'],
        last_assess_date: obj['Last Assessment Date'],
        active_plan_allocated: await validators.getPrice(obj['Active Plan Allocated']),
        active_plan_budget: await validators.getPrice(obj['Active Plan Budget']),
        active_plan_explended: obj['Active Plan Expended'],
        active_plan_version: obj['Active Plan Version'],
        curr_plan_allocated: await validators.getPrice(obj['Current Plan Allocated']),
        curr_plan_budget: await validators.getPrice(obj['Current Plan Budget']),
        curr_plan: obj['Current Plan'],
        curr_plan_status: obj['Current Plan Status'],
        curr_plan_version: obj['Current Plan Version'],
        due_date: obj['Due Date'],
        medicaid_prgm_status_code: await validators.getText(obj['Medicaid Program Status Code']),
        // pManager: emp_id,
        pPrice: await validators.getPrice(obj['Current Plan Allocated'])
        // project manager needed here
    }
    if (isUpdate) {
        return await updateOneProject(proj, com_id, pro_id, loc_id, con_id)
    } else {
        return await addProject(proj, cus_id, com_id, loc_id, con_id.con_id)
    }
}

async function addCustomer(cust) {
    // let name = cust.name
    // name = name.replace("'", "''")
    //const locations = cust.address.address_line1 + ", " + (cust.address.address_line2 ? cust.address.address_line2 + ", " : '') + cust.address.city + ", " + cust.address.state + ", " + cust.address.zip
    const locations=cust.address
    // cust.address.map((add) => {
    //   return add.address_line1 + ',' + (add.address_line2 ? add.address_line2 : '') + ',' + add.city + ',' + add.state + ',' + add.zip
    // }).join(':')

    const query = `insert into customer (cus_name, cus_local_id, cus_address, cus_phone, cus_acquired_date, cus_status, cus_type, cus_created_at, 
      cus_company_id, cus_is_company, cus_is_active, DDDID, waiver_program, cus_age, dob, cus_email, func_criteria_met, gender, 
       medicaid_eligible, home_phone, email, medicaid_id, cus_updated_at) values 
      ('${cust.name}', '${cust.cus_local_id}', '${locations}', '${cust.phone}', ${cust.acquired_date ? cust.acquired_date : 'CURRENT_TIMESTAMP'}, 'Active', '${cust.customer_type ? cust.customer_type : 'Individual'}',
       CURRENT_TIMESTAMP, '${cust.company_id ? cust.company_id : ''}', '${cust.is_company ? cust.is_company : 'False'}', 'True', '${cust.ddd_id ? cust.ddd_id : ''}',
        '${cust.waiver_prgm ? cust.waiver_prgm : ''}', '${cust.age ? cust.age : ''}', '${cust.dob ? cust.dob : ''}', '${cust.email ? cust.email : ''}', 
        '${cust.func_criteria_met ? (cust.func_criteria_met == 'N' ? '0' : '1') : ''}', '${cust.gender ? cust.gender : ''}', 
        '${cust.medicaid_eligible ? (cust.medicaid_eligible == 'N' ? '0' : '1') : ''}', '${cust.phone ? cust.phone : ''}', '${cust.email ? cust.email : ''}', '${cust.medicaid_id ? cust.medicaid_id : ''}',
        CURRENT_TIMESTAMP ); SELECT SCOPE_IDENTITY(); `

    const cus_id = await DBinsertAndSelectResponse(query)
    const custLoc = await checkLoc(cust.address, cust.company_id)
    const loc_id = !custLoc ? await addlocation(cust.address, cust.company_id,cust) : custLoc.loc_id
    //await addContact(cust, cust.company_id, cus_id[''])
    console.log('FROM ADD CUSTOMER ', loc_id[''], custLoc)
    // locArrId.push(loc_id[''])
    return { ...cus_id, locArrId: !custLoc ? loc_id[''] : loc_id }
    // }
}

async function addProject(proj, cus_id, com_id, loc_id, con_id) {

    const query = `insert into project (DDD_ID,active_plan_version, active_plan_allocated, active_plan_budget, curr_plan_allocated, 
      curr_plan_budget, curr_plan, curr_plan_version, medicaid_prgm_status_code, active_plan_expended, DDD_plan_id, plan_program_name, 
      plan_approval_date, pro_title, pro_description, pro_customer_id, pro_sponsors_id,pro_contact_id, pro_manager_id, pro_starts_on, 
      pro_ends_on, pro_price, pro_currency,pro_is_active,pro_created_at,pro_com_id, pro_updated_at) VALUES (
      '${proj.ddd_id}', 
      '${proj.active_plan_version}',
      ${proj.active_plan_allocated ? proj.active_plan_allocated : 'NULL'}, 
      ${proj.active_plan_budget ? proj.active_plan_budget : 'NULL'},
      ${proj.curr_plan_allocated ? proj.curr_plan_allocated : 'NULL'}, 
      ${proj.curr_plan_budget ? proj.curr_plan_budget : 'NULL'}, 
      ${proj.curr_plan ? proj.curr_plan : 'NULL'},
      ${proj.curr_plan_version ? proj.curr_plan_version : 'NULL'}, 
      '${proj.medicaid_prgm_status_code ? proj.medicaid_prgm_status_code : 'NULL'}',
      ${proj.active_plan_expended ? proj.active_plan_expended : 'NULL'}, 
      '${proj.active_plan_version}', 
      '${proj.waiver_prgm ? proj.waiver_prgm : 'NULL'}',
      ${proj.last_assess_date ? proj.last_assess_date : 'NULL'},
      '${proj.customer_name + ' - ' + proj.ddd_id}', 
      '${proj.pDesc ? proj.pDesc : 'Support Coordination'}',
      '${cus_id}', 
      ${proj.pSponsor ? proj.pSponsor : 'NULL'}, 
      ${con_id ? con_id : 'NULL'}, 
      ${proj.pManager ? proj.pManager : 'NULL'},
      ${proj.pstrtDate ? `DATEADD(year, -1, ${proj.due_date})` : 'CURRENT_TIMESTAMP'},
      ${proj.pEndDate ? proj.due_date : 'DATEADD(year, 1, CURRENT_TIMESTAMP)'}, 
      ${proj.pPrice ? proj.pPrice : 0}, 
      '${proj.pCurrency ? proj.pCurrency : 'USD'}',
      'True', 
      CURRENT_TIMESTAMP, 
      '${com_id}',
      CURRENT_TIMESTAMP
      ); SELECT SCOPE_IDENTITY();`

    const proj_id = await DBinsertAndSelectResponse(query)
    // select that employee and add below
    // const emp = await getEmployeeByEmpId(emp_id, com_id)
    // Assign emp to project
    try {
        await projLocationAssignment(proj_id[''], loc_id)
        // await projectEmpAssign(proj, proj_id[''], emp, emp_id)
        await projectContactAssign(proj_id[''], con_id)
    } catch (err) {
    }
    return proj_id
}

async function addlocation(address, com_id,cust) {
    const addr = validators.getAddress(address)
    var latLon = await getLatLon(addr.country, addr.state, addr.city, addr.zip)

    const query = 'insert into location(loc_addr_line1,loc_addr_line2,loc_city,loc_state,loc_zip,' +
        'loc_lat,loc_lon,loc_type,' +
        'loc_status,loc_county, loc_association_date, loc_phone_number,loc_company_id,loc_is_active) values ' +
        "('" + (addr.address_line1 ? addr.address_line1 : '') + "'," +
        "'" + (addr.address_line2 ? addr.address_line2 : '') + "'," +
        "'" + (addr.city ? addr.city : '') + "'," +
        "'" + (addr.state ? addr.state : '') + "'," +
        "'" + (addr.zip ? addr.zip : '') + "'," +
        "'" + (latLon.lat ? latLon.lat : '0') + "'," +
        "'" + (latLon.lon ? latLon.lon : '0') + "'," +
        "'" + (cust.location_type ? cust.location_type : 'Customer Location') + "'," +
        "'" + (cust.location_status ? cust.status : 'Personal') + "'," +
        "'" + (addr.country ? addr.country : 'United States') + "'," +
        "CURRENT_TIMESTAMP," +
        "'" + (cust.phone ? cust.phone : '') + "'," +
        '' + com_id + ",'true'); SELECT SCOPE_IDENTITY();"
    console.log(query)
    const locId = await DBinsertAndSelectResponse(query)
    return locId
}

async function addContact(cust, comp_id, cus_id) {
    const addr = validators.getAddress(cust.address)
    const query = `insert into contact (con_first_name, con_last_name, con_Addr_line1, con_Addr_line2, con_city, con_state, 
    con_zip, con_phone, con_email, con_company_id, con_designation, con_status, con_first_contact_date, con_last_contact_date, 
    con_is_active, con_customer_id, con_created_at, con_updated_at) values 
    ('${cust.name.split(' ')[0]}', '${cust.name.split(' ')[1]}', '${addr.address_line1}', 
    '${addr.address_line2}','${addr.city}','${addr.state}','${addr.zip}', '${cust.phone}',
    '${cust.email}', '${comp_id}', 'Client', 'Active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'true', '${cus_id}',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP); SELECT SCOPE_IDENTITY();`

    const result = await DBinsertAndSelectResponse(query)
    return result

}

async function checkLocForCust(cust, cust_id) {

    //const locations = cust.address.address_line1 + "," + (cust.address.address_line2 ? cust.address.address_line2 + "," : '') + cust.address.city + "," + cust.address.state + "," + cust.address.zip
    const locations= cust.address
    // cust.address.map((add) => {
    //   return add.address_line_1 + ',' + (add.address_line_2 ? add.address_line_2 : '') + ',' + add.city + ',' + add.state + ',' + add.zip
    // }).join(':')

    console.log('UPDATE CUSTOMER RECORD LOCATION CHECK', locations)

    const getCust = `Select * from customer where cus_id=${cust_id}`
    const customer = await DBinsertAndSelectResponse(getCust)
    let locArrId = null
    const foundLoc = customer.cus_address.split(':').some((add) => add === locations)
    // const foundLoc = customer.cus_address.some((add) => add === locations)
    let newList = !foundLoc ? '' : customer.cus_address
    console.log('Does location exist', foundLoc)
    if (!foundLoc) {
        // add the new location obj cust.address to DB
        const loc_id = await addlocation(cust.address, cust.company_id,cust)
        console.log('ADDED NEW CUSTOMER LOCATION', loc_id[''])
        locArrId = !loc_id[''] ? null : loc_id['']
        // newList = customer.cus_address + ':' + locations
        newList = locations

    } else {
        const custLoc = await checkLoc(cust.address, cust.company_id)
        console.log('Location ID Found', custLoc)
        locArrId = !custLoc ? null : custLoc.loc_id
    }
    console.log('UPDATE CUSTOMER CHECK', newList)
    // let cusAdrList = await splitAddr(customer.cus_address)
    return { loctText: newList, locArrId: locArrId }
    // console.log('UPDATE CUSTOMER CURRENT LOCATION CHECK', cusAdrList)
}

async function checkLoc(address, com) {
    const addr = validators.getAddress(address)
    const query = `SELECT loc_id from location WHERE loc_addr_line1 = '${addr.address_line1}' AND loc_addr_line2 = '${addr.address_line2}' AND loc_city = '${addr.city}' AND loc_state = '${addr.state}' AND loc_zip = '${addr.zip}' AND loc_is_active='true' AND loc_company_id='${com}'`
    const res = await DBinsertAndSelectResponse(query)
    console.log('LOCATION CHECK ', res)
    return res
}

// async function checkProjectEmployeeAssignment(emp_id, proj_id) {
//     const query = `Select * from projectEmployeeAssignment where pea_emp_id=${emp_id} and pea_pro_id=${proj_id} and pea_is_active='true'`
//     const resChek = await DBinsertAndSelectResponse(query)
//     // console.log(query,'\nResult:' ,resChek)
//     if (!resChek) {
//         await projectEmpAssign(proj_id, null, emp_id)
//     } else {
//         await updateOneProjectEmpAssgm(emp_id, proj_id)
//     }
// }

async function checkLocAssignment(pro, loc) {
    console.log(loc + " checkLocAssignemnt")
    const query = `select * from projectLocation where ploc_pro_id = ${pro} and ploc_loc_id = ${loc}`
    return await DBinsertAndSelectResponse(query)
}

async function getCustomerByDDD(ddd_id, comp_id) {
    const query = `SELECT cus_id FROM customer where DDDID = '${ddd_id}' and cus_company_id=${comp_id}`
    const result = await DBinsertAndSelectResponse(query)
    return result
}

async function getProjectId(ddd_id, active_plan_version, comp_id) {
    const query = `SELECT pro_id FROM project where DDD_ID = '${ddd_id}' and active_plan_version='${active_plan_version}' and pro_com_id=${comp_id}`
    const result = await DBinsertAndSelectResponse(query)
    return result
}

async function getContactId(comp_id, cus_id) {
    //removed the logical condition for Cust Email and First Name and Last Name

    const query = `SELECT con_id FROM contact WHERE con_company_id = '${comp_id}' and con_customer_id = '${cus_id}'`
    const result = await DBinsertAndSelectResponse(query)
    console.log(result.con_id)
    return result
}

async function getLatLon(country, state, city, zipCode) {
    try {
        country='United States'
        let obj = await axios.get('http://dev.virtualearth.net/REST/v1/Locations', {
            params: {
                countryRegion: country,
                adminDistrict: state,
                locality: city,
                postalCode: zipCode,
                key: BING_API_KEY.BING_API_KEY
            }
        })

        if (!!obj) {
            var latLon = {
                lat: obj.data.resourceSets[0].resources[0].point.coordinates[0],
                lon: obj.data.resourceSets[0].resources[0].point.coordinates[1]
            }
            return latLon
        }

    } catch (e) {
        console.log(e)
        return null
    }
}

// async function getEmployeeByEmpId(emp_id, comp_id) {
//     const query = `SELECT * FROM employee where emp_id = '${emp_id}' and emp_company_id=${comp_id}`
//     const result = await DBinsertAndSelectResponse(query)
//     return result
// }

async function updateOneCustomer(cust, com_id, cust_id) {

    const realList = await checkLocForCust(cust, cust_id, com_id)
    // console.log('UPDATE CUSTOMER LOCATION ADDED CHECK', realList)

    //const locations = cust.address.address_line1 + "," + (cust.address.address_line2 ? cust.address.address_line2 + "," : '') + cust.address.city + "," + cust.address.state + "," + cust.address.zip
    const locations=cust.address
    const query = `UPDATE customer SET cus_name='${cust.name ? cust.name.replace(/'/g, "''") : ''}', cus_address='${locations ? locations : ''}',cus_email='${cust.email ? cust.email : ''}',cus_company_id='${cust.company_id ? cust.company_id : ''}',cus_phone='${cust.phone ? cust.phone : ''}',cus_status='${cust.cus_status ? cust.cus_status : ''}', dob='${cust.dob ? cust.dob : ''}',cus_age='${cust.age ? cust.age : ''}',gender='${cust.gender ? cust.gender : ''}',cus_is_company='${cust.is_company ? cust.is_company : 'False'}', last_assess_date='${cust.last_assess_date ? cust.last_assess_date : ''}',medicaid_eligible='${cust.medicaid_eligible ? (cust.medicaid_eligible == 'N' ? '0' : '1') : ''}',renewal_date='${cust.medicaid_end_date ? cust.medicaid_end_date : ''}',medicaid_id='${cust.medicaid_id ? cust.medicaid_id : ''}',func_criteria_met='${cust.func_criteria_met ? (cust.func_criteria_met == 'N' ? '0' : '1') : ''}',cus_updated_at=CURRENT_TIMESTAMP	WHERE cus_id = ${cust_id}`
    await DBUpdate(query)
   // const result = await getContactId(com_id, cust_id)
   // await updateOneContact(cust, com_id, result.con_id)
    return { cus_id: cust_id, locArrId: realList.locArrId }
}

async function updateOneProject(proj, com_id, proj_id, loc_id, con_id) {
    console.log(proj_id + " " +loc_id + " updateOneProject")

    const query = `UPDATE project SET  DDD_ID='${proj.ddd_id}', pro_price=${proj.pPrice || 0}, last_plan_modified_date=CURRENT_TIMESTAMP, active_plan_allocated=${proj.active_plan_allocated || 0}, active_plan_budget=${proj.active_plan_budge || 0}, active_plan_expended=${proj.active_plan_expended || 0}, active_plan_version='${proj.active_plan_version || 0}', curr_plan_allocated=${proj.curr_plan_allocated || 0}, curr_plan_budget=${proj.curr_plan_budget || 0}, curr_plan=${proj.curr_plan || 0}, curr_plan_version=${proj.curr_plan_version || 0}, pro_updated_at = CURRENT_TIMESTAMP ,medicaid_prgm_status_code=${proj.medicaid_prgm_status_code ? "'" + proj.medicaid_prgm_status_code + "'" : 'NULL'} WHERE pro_id = ${proj_id} and pro_com_id = ${com_id};`
    const proj_ret = await DBUpdate(query)
    if (loc_id) {
        console.log(proj_id + " " + loc_id + " updateOneProject 2")

        await projLocationAssignment(proj_id, loc_id)
    }
    // await checkProjectEmployeeAssignment(emp_id, proj_id)
    return proj_ret
}

async function updateOneContact(cust, com_id, con_id) {

    const query = `UPDATE contact SET con_Addr_line1 = '${cust.address.address_line1}', con_Addr_line2 = '${cust.address.address_line2}', con_city = '${cust.address.city}', con_state = '${cust.address.state}', 
      con_zip = '${cust.address.zip}' ,con_phone = '${cust.phone}', con_email = '${cust.email}', con_updated_at = CURRENT_TIMESTAMP WHERE con_id = '${con_id}' AND con_company_id = '${com_id}'`

    return await DBUpdate(query)
}

// async function updateOneProjectEmpAssgm(emp_id, proj_id) {
//     const query = `UPDATE projectEmployeeAssignment SET  pea_emp_id=${emp_id}  WHERE pea_pro_id = ${proj_id} and pea_emp_id=${emp_id} and pea_is_active='true';`
//     return await DBUpdate(query)
// }

// async function projectEmpAssign(proj, proj_id, emp, emp_id) {
//     // Assign emp to project

//     const query = 'insert into projectEmployeeAssignment (pea_pro_id, pea_emp_id, pea_status,' +
//         'pea_bill_rate, pea_currency, pea_frequency, pea_associate_from, pea_associate_to,pea_is_active,pea_created_at) ' +
//         'VALUES (' +
//         '' + proj_id + ',' +
//         '' + (emp_id ? emp_id : emp) + ',' +
//         "'" + (!!emp && !!emp.pEmpStatus ? emp.pEmpStatus : 'Full Time') + "'," +
//         '' + (!!emp && !!emp.pEmpBillRate ? emp.pEmpBillRate : 11) + ',' +
//         "'" + (!!emp && !!emp.pEmpCurrency ? emp.pEmpCurrency : 'USD') + "'," +
//         "'" + (!!emp && !!emp.pEmpFrequency ? emp.pEmpFrequency : 'Hourly') + "'," +
//         '' + (!!emp && !!emp.pEmpAssFromDate ? DATEADD(year, -1, proj.due_date) : 'CURRENT_TIMESTAMP') + ',' +
//         '' + (!!emp && !!emp.pEmpAssToDate ? proj.due_date : 'DATEADD(year, 1, CURRENT_TIMESTAMP)') + ',' +
//         "'true',CURRENT_TIMESTAMP" +
//         '); SELECT SCOPE_IDENTITY();'
//     return await DBinsertAndSelectResponse(query)
// }

async function projectContactAssign(proj_id, cont_id) {

    const query = `insert into ProjectContact (proj_id, cont_id) values ('${proj_id}', '${cont_id}'); SELECT SCOPE_IDENTITY();`

    return await DBinsertAndSelectResponse(query)
}

async function projLocationAssignment(pro, loc) {
    console.log(loc + " projLocationAssignment")

    const assignCheck = await checkLocAssignment(pro, loc)
    const query = `insert into projectLocation (ploc_pro_id,ploc_loc_id) values ( ${pro},${loc} ); SELECT SCOPE_IDENTITY();`
    console.log('Checking for PLOC ASSIGNMENT', assignCheck)
    if (!assignCheck) {
        return await DBinsertAndSelectResponse(query)
    } else {
        return null
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