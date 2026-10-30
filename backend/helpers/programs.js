const {
  DBSendResponseParam,
  DBUpdateParam,
  DBinsertSendIDParam
} = require('../queries/commonQueries');

const parseId = (value) => {
  const parsed = parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : undefined;
};

const parseNullableId = (value) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return parseId(value);
};

const isValidStringInRange = (value, maxLength) => {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
};

exports.addProgram = async function (req, res) {
  const company_id = parseId(req.body.company_id);
  const created_by = parseNullableId(req.body.created_by);
  const updated_by = parseNullableId(req.body.updated_by);
  const program_name = typeof req.body.program_name === 'string'
    ? req.body.program_name.trim()
    : '';

  if (
    !company_id ||
    created_by === undefined ||
    updated_by === undefined ||
    !program_name
  ) {
    return res.status(400).json({
      message: 'Company ID and program name are required'
    });
  }

  if (program_name.length > 255) {
    return res.status(400).json({
      message: 'Program name cannot exceed 255 characters'
    });
  }

  const query = `
    INSERT INTO [dbo].[program] (
      program_name,
      company_id,
      created_by,
      updated_by
    )
    VALUES (
      @program_name,
      @company_id,
      @created_by,
      @updated_by
    );

    SELECT SCOPE_IDENTITY();
  `;

  try {
    const programId = await DBinsertSendIDParam(query, {
      program_name,
      company_id,
      created_by,
      updated_by
    });

    return res.status(201).json({
      id: programId,
      program_name
    });
  } catch (err) {
    console.log('QUERY FAILURE | addProgram Query Failed:');
    console.log(err);

    return res.status(500).json({
      message: 'An unexpected error occurred'
    });
  }
};

exports.updateProgram = async function (req, res) {
  const program_id = parseId(req.body.program_id);
  const company_id = parseId(req.body.company_id);
  const created_by = parseNullableId(req.body.created_by);
  const updated_by = parseNullableId(req.body.updated_by);
  const program_name = typeof req.body.program_name === 'string'
    ? req.body.program_name.trim()
    : '';

  if (
    !program_id ||
    !company_id ||
    created_by === undefined ||
    updated_by === undefined ||
    !program_name
  ) {
    return res.status(400).json({
      message: 'There were missing or invalid required fields'
    });
  }

  if (program_name.length > 255) {
    return res.status(400).json({
      message: 'Program name cannot exceed 255 characters'
    });
  }

  const query = `
    UPDATE [program]
    SET program_name = @program_name,
        company_id = @company_id,
        created_by = @created_by,
        updated_by = @updated_by
    WHERE program_id = @program_id
  `;

  try {
    const rowsAffected = await DBUpdateParam(query, {
      program_id,
      program_name,
      company_id,
      created_by,
      updated_by
    });

    if (rowsAffected === 0) {
      return res.status(404).json({ message: 'Program not found' });
    }

    return res.status(200).json({
      message: 'Program updated successfully',
      program_id,
      program_name
    });
  } catch (err) {
    console.log('QUERY FAILURE | updateProgram Query Failed:');
    console.log(err);

    return res.status(500).json({
      message: 'An unexpected error occurred'
    });
  }
};

exports.getPrograms = async function (req, res) {
  const conditions = [];
  const params = {};
  const program_id = parseId(req.query.program_id);
  const company_id = parseId(req.query.company_id);

  if (program_id) {
    conditions.push('program_id = @program_id');
    params.program_id = program_id;
  }

  if (company_id) {
    conditions.push('company_id = @company_id');
    params.company_id = company_id;
  }

  let query = 'SELECT * FROM [program]';
  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(' AND ')}`;
  }
  query += ' ORDER BY program_id DESC';

  try {
    const programs = await DBSendResponseParam(query, params);
    res.status(200).json(programs);
  } catch (err) {
    console.log('QUERY FAILURE | getPrograms Query Failed:');
    console.log(err);
    res.status(500).json({
      message: 'An unexpected error occurred'
    });
  }
};

exports.removeProgram = async function (req, res) {
  const program_id = parseId(req.query.program_id);

  if (!program_id) {
    res.status(400).json({
      message: 'There were missing or invalid required fields'
    });
    return;
  }

  try {
    const rowsAffected = await DBUpdateParam(
      'DELETE FROM [program] WHERE program_id = @program_id',
      { program_id }
    );

    if (rowsAffected === 0) {
      res.status(404).json({ message: 'Program not found' });
      return;
    }

    res.status(200).json({ message: 'Program deleted successfully' });
  } catch (err) {
    console.log('QUERY FAILURE | removeProgram Query Failed:');
    console.log(err);
    res.status(500).json({
      message: 'An unexpected error occurred'
    });
  }
};

exports.addProgramAssociation = async function (req, res) {
  const program_id = parseId(req.body.program_id);
  const entity_type = typeof req.body.entity_type === 'string' ? req.body.entity_type.trim() : '';
  const entity_id = typeof req.body.entity_id === 'string' ? req.body.entity_id.trim() : '';

  if (!program_id || !isValidStringInRange(entity_type, 16) || !isValidStringInRange(entity_id, 16)) {
    res.status(400).json({
      message: 'There were missing or invalid required fields'
    });
    return;
  }

  const query = `
    INSERT INTO program_association (program_id, entity_type, entity_id)
    VALUES (@program_id, @entity_type, @entity_id);
    SELECT SCOPE_IDENTITY()
  `;

  try {
    const programAssociationId = await DBinsertSendIDParam(query, {
      program_id,
      entity_type,
      entity_id
    });

    res.status(200).json({ id: programAssociationId });
  } catch (err) {
    console.log('QUERY FAILURE | addProgramAssociation Query Failed:');
    console.log(err);
    res.status(500).json({
      message: 'An unexpected error occurred'
    });
  }
};

exports.updateProgramAssociation = async function (req, res) {
  const program_association_id = parseId(req.body.program_association_id);
  const program_id = parseId(req.body.program_id);
  const entity_type = typeof req.body.entity_type === 'string' ? req.body.entity_type.trim() : '';
  const entity_id = typeof req.body.entity_id === 'string' ? req.body.entity_id.trim() : '';

  if (!program_association_id || !program_id || !isValidStringInRange(entity_type, 16) || !isValidStringInRange(entity_id, 16)) {
    res.status(400).json({
      message: 'There were missing or invalid required fields'
    });
    return;
  }

  const query = `
    UPDATE program_association
    SET program_id = @program_id,
        entity_type = @entity_type,
        entity_id = @entity_id
    WHERE program_association_id = @program_association_id
  `;

  try {
    const rowsAffected = await DBUpdateParam(query, {
      program_association_id,
      program_id,
      entity_type,
      entity_id
    });

    if (rowsAffected === 0) {
      res.status(404).json({ message: 'Program association not found' });
      return;
    }

    res.status(200).json({ message: 'Program association updated successfully' });
  } catch (err) {
    console.log('QUERY FAILURE | updateProgramAssociation Query Failed:');
    console.log(err);
    res.status(500).json({
      message: 'An unexpected error occurred'
    });
  }
};

exports.getProgramAssociations = async function (req, res) {
  const conditions = [];
  const params = {};
  const program_association_id = parseId(req.query.program_association_id);
  const program_id = parseId(req.query.program_id);
  const entity_type = typeof req.query.entity_type === 'string' ? req.query.entity_type.trim() : '';
  const entity_id = typeof req.query.entity_id === 'string' ? req.query.entity_id.trim() : '';

  if (program_association_id) {
    conditions.push('program_association_id = @program_association_id');
    params.program_association_id = program_association_id;
  }

  if (program_id) {
    conditions.push('program_id = @program_id');
    params.program_id = program_id;
  }

  if (entity_type) {
    conditions.push('entity_type = @entity_type');
    params.entity_type = entity_type;
  }

  if (entity_id) {
    conditions.push('entity_id = @entity_id');
    params.entity_id = entity_id;
  }

  let query = 'SELECT * FROM program_association';
  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(' AND ')}`;
  }
  query += ' ORDER BY program_association_id DESC';

  try {
    const programAssociations = await DBSendResponseParam(query, params);
    res.status(200).json(programAssociations);
  } catch (err) {
    console.log('QUERY FAILURE | getProgramAssociations Query Failed:');
    console.log(err);
    res.status(500).json({
      message: 'An unexpected error occurred'
    });
  }
};

exports.removeProgramAssociation = async function (req, res) {
  const program_association_id = parseId(req.query.program_association_id);

  if (!program_association_id) {
    res.status(400).json({
      message: 'There were missing or invalid required fields'
    });
    return;
  }

  try {
    const rowsAffected = await DBUpdateParam(
      'DELETE FROM program_association WHERE program_association_id = @program_association_id',
      { program_association_id }
    );

    if (rowsAffected === 0) {
      res.status(404).json({ message: 'Program association not found' });
      return;
    }

    res.status(200).json({ message: 'Program association deleted successfully' });
  } catch (err) {
    console.log('QUERY FAILURE | removeProgramAssociation Query Failed:');
    console.log(err);
    res.status(500).json({
      message: 'An unexpected error occurred'
    });
  }
};
