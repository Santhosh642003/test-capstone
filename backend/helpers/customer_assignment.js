const db = require('../models/indexSQL.js');
const { DBSendResponse, DBinsertSendID, DBUpdate } = require('../queries/commonQueries');

exports.getAssignmentsByCustomerId = async (req, res) => {
  try {
    const query = `SELECT ca.*, 
                       (SELECT emp_id, emp_first_name, emp_last_name, emp_email, emp_phone 
                        FROM employee WHERE emp_id = ca.employee_id FOR JSON PATH) as employee
                       FROM customer_assignment ca 
                       WHERE ca.customer_id = ${req.params.customer_id}`;
    let assignments = await DBSendResponse(query);
        
    assignments = assignments.map(assignment => ({
      ...assignment,
      employee: assignment.employee ? JSON.parse(assignment.employee)[0] : null
    }));
        
    res.status(200).json(assignments);
  } catch (error) {
    res.status(500).json(error);
  }
};

exports.getAssignmentsByEmployeeId = async (req, res) => {
  try {
    const query = `SELECT ca.*, 
                       (SELECT cus_id as id, cus_name as customer_name, cus_email, cus_phone 
                        FROM customer WHERE cus_id = ca.customer_id FOR JSON PATH) as customer
                       FROM customer_assignment ca 
                       WHERE ca.employee_id = ${req.params.employee_id}`;
    let assignments = await DBSendResponse(query);
        
    assignments = assignments.map(assignment => ({
      ...assignment,
      customer: assignment.customer ? JSON.parse(assignment.customer)[0] : null
    }));
        
    res.status(200).json(assignments);
  } catch (error) {
    res.status(500).json(error);
  }
};

exports.getAllAssignments = async (req, res) => {
  try {
    let query = `SELECT ca.*, 
                     (SELECT emp_id, emp_first_name, emp_last_name, emp_email 
                      FROM employee WHERE emp_id = ca.employee_id FOR JSON PATH) as employee,
                     (SELECT cus_id as id, cus_name as customer_name, cus_email 
                      FROM customer WHERE cus_id = ca.customer_id FOR JSON PATH) as customer
                     FROM customer_assignment ca`;
        
    if (req.query.company_id) {
      query += ` WHERE ca.company_id = ${req.query.company_id}`;
    }
        
    let assignments = await DBSendResponse(query);
        
    assignments = assignments.map(assignment => ({
      ...assignment,
      employee: assignment.employee ? JSON.parse(assignment.employee)[0] : null,
      customer: assignment.customer ? JSON.parse(assignment.customer)[0] : null
    }));
        
    res.status(200).json(assignments);
  } catch (error) {
    res.status(500).json(error);
  }
};

exports.getAssignmentById = async (req, res) => {
  try {
    const query = `SELECT ca.*, 
                       (SELECT emp_id, emp_first_name, emp_last_name, emp_email, emp_phone 
                        FROM employee WHERE emp_id = ca.employee_id FOR JSON PATH) as employee,
                       (SELECT cus_id as id, cus_name as customer_name, cus_email, cus_phone 
                        FROM customer WHERE cus_id = ca.customer_id FOR JSON PATH) as customer
                       FROM customer_assignment ca 
                       WHERE ca.assignment_id = ${req.params.assignment_id}`;
    let assignment = await DBSendResponse(query);
        
    if (assignment.length === 0) {
      return res.status(404).json({ message: 'Assignment not found' });
    }
        
    assignment = assignment.map(a => ({
      ...a,
      employee: a.employee ? JSON.parse(a.employee)[0] : null,
      customer: a.customer ? JSON.parse(a.customer)[0] : null
    }))[0];
        
    res.status(200).json(assignment);
  } catch (error) {
    res.status(500).json(error);
  }
};

exports.createAssignment = async (req, res) => {
  try {
    const { employee_id, customer_id, relationtype, company_id } = req.body;
        
    if (!employee_id || !customer_id || !relationtype || !company_id) {
      return res.status(400).json({ message: 'Missing required fields: employee_id, customer_id, relationtype, company_id' });
    }
        
    const query = `INSERT INTO customer_assignment (employee_id, customer_id, relationtype, company_id)
                       VALUES (${employee_id}, ${customer_id}, '${relationtype}', ${company_id}); SELECT SCOPE_IDENTITY()`;
        
    const assignment_id = await DBinsertSendID(query);
        
    if (!assignment_id) {
      return res.status(500).json({ message: 'Failed to create assignment' });
    }
        
    res.status(201).json({ assignment_id, message: 'Assignment created successfully' });
  } catch (error) {
    res.status(500).json(error);
  }
};

exports.updateAssignment = async (req, res) => {
  try {
    const { relationtype } = req.body;
        
    if (!relationtype) {
      return res.status(400).json({ message: 'relationtype is required' });
    }
        
    const query = `UPDATE customer_assignment
                       SET relationtype = '${relationtype}'
                       WHERE assignment_id = ${req.params.assignment_id}`;
        
    const result = await DBUpdate(query);
        
    if (result === 0) {
      return res.status(404).json({ message: 'Assignment not found or no changes made' });
    }
        
    res.status(200).json({ message: 'Assignment updated successfully' });
  } catch (error) {
    res.status(500).json(error);
  }
};

exports.deleteAssignment = async (req, res) => {
  try {
    const query = `DELETE FROM customer_assignment WHERE assignment_id = ${req.params.assignment_id}`;
    const result = await DBUpdate(query);
        
    if (result === 0) {
      return res.status(404).json({ message: 'Assignment not found' });
    }
        
    res.status(204).send();
  } catch (error) {
    res.status(500).json(error);
  }
};

exports.bulkUpdateAssignments = async (req, res) => {
  try {
    const transaction = new db.Transaction();

    transaction.begin(err => {
      const request = new db.Request(transaction);

      request.query(`DELETE FROM [dbo].[customer_assignment] WHERE customer_id = ${req.body.customer_id} AND company_id = ${req.body.company_id} AND relationtype = '${req.body.relationtype}'`, (err, result) => { 
        if(err) {
          console.log(err);
          transaction.rollback(err => {
            res.json({ code: 500, message: 'Update failed' });
          });
        } else {
          if (req.body.empData.length > 0) {
            request.query('INSERT INTO [dbo].[customer_assignment] (employee_id, customer_id, relationtype, company_id) VALUES ' +
              req.body.empData.map(emp => `(${emp.id}, ${req.body.customer_id}, '${req.body.relationtype}', ${req.body.company_id})`).join(', '), (err, result) => {
              if(err) {
                console.log(err);
                transaction.rollback(err => {
                  res.json({ code: 500, message: 'Update failed' });
                });
              } else {
                transaction.commit(err => {
                  res.json({ code: 200, message: 'Update Success' });
                });
              }
            });
          } else {
            transaction.commit(err => {
              res.json({ code: 200, message: 'Update Success' });
            });
          }
        }
      });
    });
  }
  catch {
    return res.json({ code: 500, message: 'Update Failed' });
  }
};

exports.bulkUpdateAssignmentsByEmployee = async (req, res) => {
  try {
    const employeeId = Number.parseInt(req.body.employee_id, 10);
    const companyId = Number.parseInt(req.body.company_id, 10);
    const relationtype = String(req.body.relationtype || '').trim();

    const customerData = Array.isArray(req.body.customerData)
      ? req.body.customerData
      : [];

    const customerIds = [
      ...new Set(
        customerData
          .map(customer => Number.parseInt(customer.id, 10))
          .filter(Number.isInteger)
      )
    ];

    if (
      !Number.isInteger(employeeId) ||
      !Number.isInteger(companyId) ||
      !relationtype
    ) {
      return res.status(400).json({
        code: 400,
        message: 'employee_id, company_id, and relationtype are required'
      });
    }

    const escapedRelationType = relationtype.replace(/'/g, '\'\'');

    const insertStatement = customerIds.length > 0
      ? `
        INSERT INTO dbo.customer_assignment (
          employee_id,
          customer_id,
          relationtype,
          company_id
        )
        VALUES ${customerIds
    .map(customerId =>
      `(${employeeId}, ${customerId}, '${escapedRelationType}', ${companyId})`
    )
    .join(', ')};
      `
      : '';

    const query = `
      SET XACT_ABORT ON;

      BEGIN TRY
        BEGIN TRANSACTION;

        DELETE FROM dbo.customer_assignment
        WHERE employee_id = ${employeeId}
          AND company_id = ${companyId}
          AND relationtype = '${escapedRelationType}';

        ${insertStatement}

        COMMIT TRANSACTION;

        SELECT
          200 AS code,
          ${customerIds.length} AS assignment_count;
      END TRY
      BEGIN CATCH
        IF @@TRANCOUNT > 0
          ROLLBACK TRANSACTION;

        THROW;
      END CATCH;
    `;

    console.log('Bulk employee assignment query:', {
      employeeId,
      companyId,
      relationtype,
      customerIds
    });

    await DBSendResponse(query);

    return res.status(200).json({
      code: 200,
      message: 'Customer assignments updated successfully',
      assignment_count: customerIds.length
    });
  } catch (error) {
    console.error('Bulk employee assignment update failed:', error);

    return res.status(500).json({
      code: 500,
      message: 'Failed to update customer assignments',
      error: error.message
    });
  }
};