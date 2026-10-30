const { DBinsertSendID, DBSendResponse } = require('../queries/commonQueries')

// GET all schema entries
exports.getAllSchemas = async (req, res) => {
  try {
    const query = `SELECT * FROM fwschema`
    let result = await DBSendResponse(query)
    res.json(result)
  } catch (err) {
    res.json({ error: err.message })
  }
}

// GET schema by ID
exports.getSchemaById = async (req, res) => {
  try {
    const query = `SELECT * FROM fwschema WHERE schemaID = ${req.params.id}`
    let result = await DBSendResponse(query)
    res.json(result[0] || null)
  } catch (err) {
    res.json({ error: err.message })
  }
}

// CREATE new schema entry
exports.postSchema = async (req, res) => {
  try {
    const {
      tableName,
      columnName,
      columnLabel,
      columnVisible,
      columnOptional,
      companyID,
      companyState,
      companyTypeOfBusiness,
      schemaAddedBy,
      schemaAddedOn
    } = req.body

    const query = `INSERT INTO fwschema 
      (tableName, columnName, columnLabel, columnVisible, columnOptional, companyID, companyState, companyTypeOfBusiness, schemaAddedBy, schemaAddedOn)
      VALUES ('${tableName}', '${columnName}', '${columnLabel}', ${columnVisible || 0}, ${columnOptional || 0}, ${companyID || null}, '${companyState}', ${companyTypeOfBusiness || null}, ${schemaAddedBy || null}, '${schemaAddedOn}');
      SELECT SCOPE_IDENTITY();`

    let result = await DBinsertSendID(query)
    res.json(result)
  } catch (err) {
    res.json({ error: err.message })
  }
}

// UPDATE schema entry
exports.updateSchemaById = async (req, res) => {
  try {
    const {
      tableName,
      columnName,
      columnLabel,
      columnVisible,
      columnOptional,
      companyID,
      companyState,
      companyTypeOfBusiness,
      schemaAddedBy,
      schemaAddedOn
    } = req.body

    const query = `UPDATE fwschema SET 
      tableName='${tableName}', columnName='${columnName}', columnLabel='${columnLabel}', columnVisible=${columnVisible || 0}, columnOptional=${columnOptional || 0}, companyID=${companyID || null}, companyState='${companyState}', companyTypeOfBusiness=${companyTypeOfBusiness || null}, schemaAddedBy=${schemaAddedBy || null}, schemaAddedOn='${schemaAddedOn}'
      WHERE schemaID=${req.params.id}`

    await DBSendResponse(query)
    res.send()
  } catch (err) {
    res.json({ error: err.message })
  }
}

// DELETE schema entry
exports.deleteSchemaById = async (req, res) => {
  try {
    const query = `DELETE FROM fwschema WHERE schemaID = ${req.params.id}`
    await DBSendResponse(query)
    res.send()
  } catch (err) {
    res.json({ error: err.message })
  }
}

// GET schema rows for a specific table and company (companyID from query param)
exports.getSchemaByTableAndCompany = async (req, res) => {
  try {
    const { tableName } = req.params
    const { companyID } = req.query
    const query = `SELECT * FROM fwschema WHERE tableName = '${tableName}' AND companyID = ${companyID}`
    console.log(`Query: ${query}`);
    
    let result = await DBSendResponse(query)
    res.json(result)
  } catch (err) {
    res.json({ error: err.message })
  }
}

// GET default schema rows for a table based on state and type of business (companyID is null)
exports.getDefaultSchemaByTableStateType = async (req, res) => {
  try {
    const { tableName } = req.params
    const { companyTypeOfBusiness } = req.query
    const query = `SELECT * FROM fwschema WHERE tableName = '${tableName}' AND companyID = -1 AND companyTypeOfBusiness = ${companyTypeOfBusiness > 99 ? companyTypeOfBusiness : -1}`
    let result = await DBSendResponse(query)
    res.json(result)
  } catch (err) {
    res.json({ error: err.message })
  }
}
