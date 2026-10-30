const { DBUpdate, DBSendResponse, DBinsertSendID } = require("../queries/commonQueries");
const cron = require("node-cron");
const axios = require("axios");

exports.updateList = async () => {
  cron.schedule("0 0 1 * *", async function () {
    try {
      const apiResponse = await axios.get(
        "https://oig.hhs.gov/exclusions/downloadables/UPDATED.csv"
      );

      if (apiResponse === undefined) {
        throw 500;
      }

      const exclusionsListData = apiResponse.data;

      if (exclusionsListData === undefined) {
        throw 500;
      }

      let query = `DELETE TOP (10000) FROM exclusions_list;`;

      while (true) {
        let deletedRows = await DBUpdate(query);
        if (deletedRows === 0) {
          break;
        }
      }

      let res = await DBUpdate(query);

      let rowNumber = 0;
      let columnsNames = [];
      const dateIndices = [];

      query = "";

      for (let row of exclusionsListData.split("\r\n")) {
        if (rowNumber == 0) {
          columnsNames = row
            .split(",")
            .map((element) => element.replace(/['"]+/g, ""));
          columnsNames.map((x, i) => {
            if (x.substr(-4) == "DATE" || x === 'DOB') {
              dateIndices.push(i);
            }
          });
          rowNumber++;
          query =
            query +
            `INSERT INTO exclusions_list (${columnsNames.filter(
              (a, b) => a + "," + b
            )}) VALUES `;
          continue;
        }

        let values = row
          .split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/)
          .map((element) => element.replace(/['"]+/g, "").trim())
          .map((x, i) => {
            if (dateIndices.includes(i)) {
              var year = x.substring(0, 4);
              var month = x.substring(4, 6);
              var day = x.substring(6, 8);
              const date = new Date(year, month, day);
              return `'${date.toISOString().slice(0, 19).replace("T", " ")}'`;
            }
            return `'${x}'`;
          });

        if (values.length !== columnsNames.length) {
          continue;
        }

        query =
          query +
          `
           (${values.filter((a, b) => a + "," + b)}),`;

        if (rowNumber % 1000 === 0) {
          res = await DBUpdate(query.slice(0, -1));

          console.log(res);

          query = `INSERT INTO exclusions_list (${columnsNames.filter(
            (a, b) => a + "," + b
          )}) VALUES `;
        }

        rowNumber++;
      }

      res = await DBUpdate(query.slice(0, -1));

      let dateQuery = `UPDATE [dbo].[exclusions_list]
      SET REINDATE = CASE
              WHEN REINDATE = '1899-12-31T00:00:00.0000000' THEN null
                       ELSE REINDATE
                     END,
          WAIVERDATE = CASE 
                      WHEN WAIVERDATE = '1899-12-31T00:00:00.0000000' THEN null
                      ELSE WAIVERDATE
                     END,
          DOB = CASE 
                     WHEN DOB = '1899-12-31T00:00:00.0000000' THEN null
                     ELSE DOB
                END`

      res = await DBUpdate(dateQuery);

      console.log("Sucessfully updated exclusions list to the database!");
    } catch (error) {
      console.log("Error Occured in exclusions list cron job ", error);
    }
  });
};

exports.getCompanyReport = async (request, response) => {
  try {
    let company = request.query.companyID;

    if (company === undefined) {
      return response.status(400).send("Provide comapny id");
    }
    if (typeof company !== "string") {
      return response.status(400).send("comapny id should be of string type");
    }

    if (company.trim().length === 0) {
      return response.status(400).send("Company id cannot be an empty string");
    }

    for (const c of company) {
      if (isNaN(parseInt(c))) {
        return response.status(400).send("comapny id should only have digits");
      }
    }

    let query = `SELECT emp_first_name,emp_last_name,emp_zip FROM employee WHERE emp_company_id=${company} AND emp_is_active='true'`;

    const employees = await DBSendResponse(query);

    if (employees.length == 0) {
      return response.status(404).send("Employer not found in the list");
    }

    let employeeReports = [];

    for (const employee of employees) {
      const employeeQuery = `SELECT * FROM exclusions_list WHERE trim(FIRSTNAME) = '${employee.emp_first_name.toUpperCase()}' and trim(LASTNAME) ='${employee.emp_last_name.toUpperCase()}' and ZIP = '${employee.emp_zip
        }'`;
      const employeeReport = await DBSendResponse(employeeQuery);
      employeeReports = employeeReports.concat(employeeReport);
    }

    query = `SELECT  com_name AS company_name, com_taxid as company_taxid FROM company WHERE com_id=${company}`;

    const companyInfo = await DBSendResponse(query);

    if (companyInfo.length == 0) {
      return response.status(404).send("Employer not found in the database");
    }

    companyInfo[0].employeesDebarementReport = employeeReports;

    return response.status(200).send(companyInfo[0]);
  } catch (error) {
    console.log(error);
    return response.status(500).send("Unknown error occured");
  }
};

exports.getReportData = async (com_id) => {
  try {

    let company = com_id;

    if (company === undefined) {
      return console.log("Provide comapny id");
    }
    if (typeof company !== "string") {
      return console.log("comapny id should be of string type");
    }

    if (company.trim().length === 0) {
      return console.log("Company id cannot be an empty string");
    }

    for (const c of company) {
      if (isNaN(parseInt(c))) {
        return console.log("comapny id should only have digits");
      }
    }

    // let query = `SELECT emp_first_name,emp_last_name,emp_zip FROM employee WHERE emp_company_id=${company} AND emp_is_active='true'`;

    // const employees = await DBSendResponse(query);

    // if (employees.length == 0) {
    //   return response.status(404).send("Employer not found in the list");
    // }

    // let employeeReports = [];

    // for (const employee of employees) {
    //   const employeeQuery = `SELECT * FROM exclusions_list WHERE trim(FIRSTNAME) = '${employee.emp_first_name.toUpperCase()}' and trim(LASTNAME) ='${employee.emp_last_name.toUpperCase()}' and ZIP = '${employee.emp_zip
    //     }'`;
    //   const employeeReport = await DBSendResponse(employeeQuery);
    //   employeeReports = employeeReports.concat(employeeReport);
    // }

    let query = `select * from [dbo].[exclusions_list] ex, [dbo].[employee] emp where trim(FIRSTNAME) = UPPER(emp_first_name) and trim(LASTNAME) = UPPER(emp_last_name) and ZIP = emp_zip and emp_company_id=${company}`

    const employeeReports = await DBSendResponse(query);

    // query = `SELECT  com_name AS company_name, com_taxid as company_taxid FROM company WHERE com_id=${company}`;

    // const companyInfo = await DBSendResponse(query);

    // if (companyInfo.length == 0) {
    //   return console.log("Employer not found in the database");
    // }

    // companyInfo[0].employeesDebarementReport = employeeReports;

    // return companyInfo[0];
    return employeeReports
  } catch (error) {
    console.log(error);
  }
};

exports.getConsolidatedDebar = async () => {
  cron.schedule("0 0 1 * *", async function () {
    try {
      let query = `DELETE FROM [dbo].[DebarmentData]`;

      const res = await DBUpdate(query);

      const apiResponse = await axios.get("https://www.nj.gov/treasury/treasfiles/debarment/Debarment-MEDICAL2.txt");
      const consolidatedDebarData = apiResponse.data;

      let rows = []
      for (let row of consolidatedDebarData.split(/\r?\n/)) {
        let currRow = row.split('%')
        currRow.splice(-3)
        if (currRow.length !== 22) {
          continue;
        }
        let names = []
        if (currRow[1].indexOf(",") !== -1) {
          // names = currRow[1].split(",")
          const [first, ...rest] = currRow[1].split(',');
          const remainder = rest.join(',');
          names = [first, remainder]
          names = names.map((name) => {
            if (name.indexOf("(") !== -1) {
              name = name.substring(0, name.indexOf("("));
            }
            if (name.indexOf("AKA") !== -1) {
              name = name.substring(0, name.indexOf("AKA"));
            }
            return name.trim();
          })
        }
        else {
          names = ['', currRow[1].indexOf("(") !== -1 ? currRow[1].substring(0, currRow[1].indexOf("(")) : currRow[1]]
        }

        currRow = currRow.slice(0, 1).concat(names).concat(currRow.slice(2))
        rows.push(currRow)
      }

      for (let i = 0; i < rows.length; i += 1000) {
        let query = `INSERT INTO DebarmentData (FirmName, IndividualLastName, IndividualFirstName, VendorID, FirmStreet, FirmCity, FirmState, FirmZIP, FirmPlus4, NPINumber, IndividualStreet, IndividualCity, IndividualState, IndividualZIP, IndividualPlus4, Category, Action, Reason, DebarringDepartment, DebarringAgency, EffectiveDate, ExpirationDate, PermanentDebarment) VALUES `;

        for (let j = i; j < Math.min(rows.length, i + 1000); j++) {

          query += "("
          rows[j].forEach((ele, index) => {
            query += `'${ele.replaceAll("'", "''")}'`

            if (index !== rows[j].length - 1) {
              query += ','
            }
          })
          query += ")"

          if (j !== Math.min(rows.length, i + 1000) - 1)
            query += ","
        }
        query += "; SELECT SCOPE_IDENTITY();"

        const resp = await DBinsertSendID(query);
      }
      console.log("Sucessfully updated NJ consolidated debarment data to the database!");
    }
    catch (error) {
      console.log("Error Occured in NJ consolidated debarment data cron job ", error);
    }
  })
}

exports.getDebarData = async (com_id) => {
  try {

    let company = com_id;

    if (company === undefined) {
      return console.log("Provide comapny id");
    }
    if (typeof company !== "string") {
      return console.log("comapny id should be of string type");
    }

    if (company.trim().length === 0) {
      return console.log("Company id cannot be an empty string");
    }

    for (const c of company) {
      if (isNaN(parseInt(c))) {
        return console.log("comapny id should only have digits");
      }
    }

    let query = `select * 
                  from [dbo].[DebarmentData] d, [dbo].[employee] emp 
                  where IndividualLastName != '' and IndividualLastName = UPPER(emp_last_name) and IndividualFirstName != '' and IndividualFirstName = UPPER(emp_first_name) and IndividualZip != '' and IndividualZip = emp_zip and emp_company_id=${company}`

    const employeeReports = await DBSendResponse(query);

    return employeeReports

  } catch (error) {
    console.log(error);
  }
};