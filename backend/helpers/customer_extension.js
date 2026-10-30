const {
  DBinsertSendID,
  DBSendResponse,
  DBinsertSendResponse
} = require('../queries/commonQueries');


exports.addCustomerExtension = async function (req, res) {
  if (!(req.body.cus_id && !isNaN(parseInt(req.body.cus_id)))) {
    res.status(400).json({
      message: 'There were missing or invalid required fields (cus_id)'
    });
    return;
  }

  // Simple validation and sanitization
  const cus_id = parseInt(req.body.cus_id);
  const race = req.body.race ? req.body.race.substring(0, 100) : null;
  const ethnicity = req.body.ethnicity ? req.body.ethnicity.substring(0, 100) : null;
  const preferred_language = req.body.preferred_language ? req.body.preferred_language.substring(0, 100) : null;
  const marital_status = req.body.marital_status ? req.body.marital_status.substring(0, 50) : null;

  const query = `
    INSERT INTO customer_extension (cus_id, race, ethnicity, preferred_language, marital_status)
    VALUES (${cus_id}, ${race ? `'${race.replace(/'/g, '\'\'')}'` : 'NULL'}, ${ethnicity ? `'${ethnicity.replace(/'/g, '\'\'')}'` : 'NULL'}, ${preferred_language ? `'${preferred_language.replace(/'/g, '\'\'')}'` : 'NULL'}, ${marital_status ? `'${marital_status.replace(/'/g, '\'\'')}'` : 'NULL'});
    SELECT SCOPE_IDENTITY();
  `;

  try {
    // Check if customer extension already exists for this customer
    const checkQuery = `SELECT * FROM customer_extension WHERE cus_id = ${cus_id}`;
    const checkResponse = await DBinsertSendResponse(checkQuery);
    if (checkResponse.length > 0) {
      res.status(400).json({
        message: 'Customer extension already exists for this customer'
      });
      return;
    }

    const newCustomerExtensionId = await DBinsertSendID(query);
    res.status(200).json({
      message: 'Customer extension added successfully',
      id: newCustomerExtensionId
    });
  } catch (err) {
    console.log('QUERY FAILURE | addCustomerExtension Query Failed:');
    console.log(err);
    res.status(500).json({
      message: 'An unexpected error occurred'
    });
  }
};

exports.updateCustomerExtension = async function (req, res) {
  const conditions = [];
  if (req.body.customer_extension_id && !isNaN(parseInt(req.body.customer_extension_id))) {
    conditions.push(`customer_extension_id = ${parseInt(req.body.customer_extension_id)}`);
  }
  if (req.body.cus_id && !isNaN(parseInt(req.body.cus_id))) {
    conditions.push(`cus_id = ${parseInt(req.body.cus_id)}`);
  }
    
  if (conditions.length === 0) {
    res.status(400).json({
      message: 'There were missing or invalid required fields (customer_extension_id or cus_id)'
    });
    return;
  }

  // Simple validation and sanitization
  const race = req.body.race ? req.body.race.substring(0, 100) : null;
  const ethnicity = req.body.ethnicity ? req.body.ethnicity.substring(0, 100) : null;
  const preferred_language = req.body.preferred_language ? req.body.preferred_language.substring(0, 100) : null;
  const marital_status = req.body.marital_status ? req.body.marital_status.substring(0, 50) : null;

  let query = `
    UPDATE customer_extension 
    SET race = ${race ? `'${race.replace(/'/g, '\'\'')}'` : 'NULL'},
        ethnicity = ${ethnicity ? `'${ethnicity.replace(/'/g, '\'\'')}'` : 'NULL'},
        preferred_language = ${preferred_language ? `'${preferred_language.replace(/'/g, '\'\'')}'` : 'NULL'},
        marital_status = ${marital_status ? `'${marital_status.replace(/'/g, '\'\'')}'` : 'NULL'}
    WHERE `;
  query += conditions.join(' AND ');

  try {
    await DBSendResponse(query);
    res.status(200).json({
      message: 'Customer extension updated successfully'
    });
  } catch (err) {
    console.log('QUERY FAILURE | updateCustomerExtension Query Failed:');
    console.log(err);
    res.status(500).json({
      message: 'An unexpected error occurred'
    });
  }
};

exports.getCustomerExtension = async function (req, res) {
  const conditions = [];
  if (req.query.customer_extension_id && !isNaN(parseInt(req.query.customer_extension_id))) {
    conditions.push(`customer_extension_id = ${parseInt(req.query.customer_extension_id)}`);
  }
  if (req.query.cus_id && !isNaN(parseInt(req.query.cus_id))) {
    conditions.push(`cus_id = ${parseInt(req.query.cus_id)}`);
  }
    
  if (conditions.length === 0) {
    res.status(400).json({
      message: 'There were missing or invalid required fields (customer_extension_id or cus_id)'
    });
    return;
  }

  let query = 'SELECT customer_extension_id, cus_id, race, ethnicity, preferred_language, marital_status FROM customer_extension WHERE ';
  query += conditions.join(' AND ');

  try {
    let response = await DBSendResponse(query);
    res.status(200).json(response);
  } catch (err) {
    console.log('QUERY FAILURE | getCustomerExtension Query Failed:');
    console.log(err);
    res.status(500).json({
      message: 'An unexpected error occurred'
    });
  }
};

exports.removeCustomerExtension = async function (req, res) {
  if (!(req.query.customer_extension_id && !isNaN(parseInt(req.query.customer_extension_id)))) {
    res.status(400).json({
      message: 'There were missing or invalid required fields (customer_extension_id)'
    });
    return;
  }

  const query = `DELETE FROM customer_extension WHERE customer_extension_id = ${parseInt(req.query.customer_extension_id)}`;

  try {
    await DBSendResponse(query);
    res.status(200).json({
      message: 'Customer extension deleted successfully'
    });
  } catch (err) {
    console.log('QUERY FAILURE | removeCustomerExtension Query Failed:');
    console.log(err);
    res.status(500).json({
      message: 'An unexpected error occurred'
    });
  }
};

exports.getCustomerWithExtension = async function (req, res) {
  if (!(req.query.cus_id && !isNaN(parseInt(req.query.cus_id)))) {
    res.status(400).json({
      message: 'There were missing or invalid required fields (cus_id)'
    });
    return;
  }

  const query = `
        SELECT 
            c.*,
            ce.customer_extension_id,
            ce.race,
            ce.ethnicity,
            ce.preferred_language,
            ce.marital_status
        FROM customer c
        LEFT JOIN customer_extension ce ON c.cus_id = ce.cus_id
        WHERE c.cus_id = ${parseInt(req.query.cus_id)}
    `;

  try {
    let response = await DBSendResponse(query);
    res.status(200).json(response);
  } catch (err) {
    console.log('QUERY FAILURE | getCustomerWithExtension Query Failed:');
    console.log(err);
    res.status(500).json({
      message: 'An unexpected error occurred'
    });
  }
};