const { DBinsertSendID, DBinsert, DBUpdate, DBSendResponse, DBInsertAndReturn } = require('../queries/commonQueries');
const { Analytics } = require('@segment/analytics-node');
const { SEGMENT_API_KEY } = require('../config');

const analytics = new Analytics({ writeKey: SEGMENT_API_KEY });

// ============ HOUSEHOLD CRUD OPERATIONS ============

// Get all households for a company
exports.getHouseholds = async function (req, res) {
  try {
    const comp_id = req.query.comp_id;
    const household_id = req.query.household_id;
    const is_actively_serviced = req.query.is_actively_serviced;
    
    let query = `
      SELECT h.*, 
             l.loc_addr_line1, l.loc_addr_line2, l.loc_city, l.loc_state, l.loc_zip,
             e.emp_first_name AS added_by_first_name, e.emp_last_name AS added_by_last_name,
             (SELECT COUNT(*) FROM household_member WHERE household_id = h.household_id) AS member_count
      FROM household h
      LEFT JOIN Location l ON h.loc_id = l.loc_id
      LEFT JOIN Employee e ON h.added_by = e.emp_id
      WHERE 1=1
    `;
    
    if (comp_id) {
      query += ` AND h.company_id = ${comp_id}`;
    }
    
    if (household_id) {
      query += ` AND h.household_id = ${household_id}`;
    }
    
    if (is_actively_serviced !== undefined) {
      query += ` AND h.is_actively_serviced = ${is_actively_serviced === 'true' ? 1 : 0}`;
    }
    
    query += ' ORDER BY h.date_added DESC';
    
    const households = await DBSendResponse(query);
    res.json(households);
  } catch (err) {
    console.error('Error in getHouseholds:', err);
    res.status(500).json({ code: 500, message: 'Error fetching households' });
  }
};

// Get single household with full details
exports.getHouseholdById = async function (req, res) {
  try {
    const household_id = req.params.household_id;
    
    const query = `
      SELECT h.*, 
             l.loc_addr_line1, l.loc_addr_line2, l.loc_city, l.loc_state, l.loc_zip,
             e.emp_first_name AS added_by_first_name, e.emp_last_name AS added_by_last_name
      FROM household h
      LEFT JOIN Location l ON h.loc_id = l.loc_id
      LEFT JOIN Employee e ON h.added_by = e.emp_id
      WHERE h.household_id = ${household_id}
    `;
    
    const households = await DBSendResponse(query);
    console.log('Fetched household details:', households);
    if (households && households.length > 0) {
      res.json(households[0]);
    } else {
      res.status(404).json({ code: 404, message: 'Household not found' });
    }
  } catch (err) {
    console.error('Error in getHouseholdById:', err);
    res.status(500).json({ code: 500, message: 'Error fetching household' });
  }
};

// Create new household
exports.addNewHousehold = async function (req, res) {
  try {
    let household_name = (req.body.household_name ?? '').normalize('NFC').replace(/'/g, '\'\'');
    let household_description = req.body.household_description 
      ? req.body.household_description.normalize('NFC').replace(/'/g, '\'\'') 
      : '';
    
    const query = `
      INSERT INTO household (
        household_name, 
        household_description,
        company_id, 
        loc_id, 
        date_added,
        date_last_visited,
        is_actively_serviced, 
        added_by
      ) VALUES (
        '${household_name}',
        '${household_description}',
        ${req.body.company_id},
        ${req.body.loc_id || 'NULL'},
        GETDATE(),
        ${req.body.date_last_visited ? `'${req.body.date_last_visited}'` : 'NULL'},
        ${req.body.is_actively_serviced !== undefined ? (req.body.is_actively_serviced ? 1 : 0) : 1},
        ${req.body.added_by || 'NULL'}
      ); 
      SELECT SCOPE_IDENTITY();
    `;
    
    const result = await DBInsertAndReturn(query);
    
    // Track event in Segment
    if (req.body.emp_id && req.body.company_id && req.body.emp_name) {
      analytics.track({
        userId: String(req.body.emp_id),
        event: 'New household added',
        context: {
          groupId: req.body.company_id,
        },
        properties: {
          uploadedBy: req.body.emp_name,
          companyId: req.body.company_id,
          householdName: household_name,
        },
      });
    }
    
    res.json(result);
  } catch (err) {
    console.error('Error in addNewHousehold:', err);
    res.status(500).json({ code: 500, message: 'Error creating household' });
  }
};

// Update household
exports.updateHousehold = async function (req, res) {
  try {
    let household_name = (req.body.household_name ?? '').normalize('NFC').replace(/'/g, '\'\'');
    let household_description = req.body.household_description 
      ? req.body.household_description.normalize('NFC').replace(/'/g, '\'\'') 
      : '';
    
    const query = `
      UPDATE household 
      SET 
        household_name = '${household_name}',
        household_description = '${household_description}',
        loc_id = ${req.body.loc_id || 'NULL'},
        date_last_visited = ${req.body.date_last_visited ? `'${req.body.date_last_visited}'` : 'NULL'},
        is_actively_serviced = ${req.body.is_actively_serviced !== undefined ? (req.body.is_actively_serviced ? 1 : 0) : 1}
      WHERE household_id = ${req.body.household_id}
    `;
    
    const out = await DBUpdate(query);
    if (out == 0) {
      res.json({ code: 500, message: 'Update failed' });
    } else {
      res.json({ code: 200, message: 'Household updated successfully' });
    }
  } catch (err) {
    console.error('Error in updateHousehold:', err);
    res.status(500).json({ code: 500, message: 'Error updating household' });
  }
};

// Delete household (soft delete by setting inactive)
exports.deleteHousehold = async function (req, res) {
  try {
    const household_id = req.query.household_id;
    
    // Soft delete by setting is_actively_serviced to false
    const query = `
      UPDATE household 
      SET is_actively_serviced = 0
      WHERE household_id = ${household_id}
    `;
    
    const out = await DBUpdate(query);
    if (out == 0) {
      res.json({ code: 500, message: 'Delete failed' });
    } else {
      res.json({ code: 200, message: 'Household deleted successfully' });
    }
  } catch (err) {
    console.error('Error in deleteHousehold:', err);
    res.status(500).json({ code: 500, message: 'Error deleting household' });
  }
};

// ============ HOUSEHOLD MEMBER CRUD OPERATIONS ============

// Get all members for a household
exports.getHouseholdMembers = async function (req, res) {
  try {
    const household_id = req.query.household_id;
    const household_member_id = req.query.household_member_id;
    
    let query = `
      SELECT hm.*,
             c.cus_name, c.cus_phone, c.cus_email,
             con.con_first_name, con.con_last_name, con.con_phone, con.con_email,
             e.emp_first_name AS added_by_first_name, e.emp_last_name AS added_by_last_name,
             CASE 
               WHEN hm.customer_id IS NOT NULL THEN 'customer'
               WHEN hm.contact_id IS NOT NULL THEN 'contact'
               ELSE 'unknown'
             END AS member_type
      FROM household_member hm
      LEFT JOIN Customer c ON hm.customer_id = c.cus_id
      LEFT JOIN Contact con ON hm.contact_id = con.con_id
      LEFT JOIN Employee e ON hm.added_by = e.emp_id
      WHERE 1=1
    `;
    
    if (household_id) {
      query += ` AND hm.household_id = ${household_id}`;
    }
    
    if (household_member_id) {
      query += ` AND hm.household_member_id = ${household_member_id}`;
    }
    
    query += ' ORDER BY hm.date_added DESC';
    
    const members = await DBSendResponse(query);
    res.json(members);
  } catch (err) {
    console.error('Error in getHouseholdMembers:', err);
    res.status(500).json({ code: 500, message: 'Error fetching household members' });
  }
};

// Get single household member
exports.getHouseholdMemberById = async function (req, res) {
  try {
    const household_member_id = req.params.household_member_id;
    
    const query = `
      SELECT hm.*,
             c.cus_first_name, c.cus_last_name, c.cus_phone, c.cus_email,
             con.con_first_name, con.con_last_name, con.con_phone, con.con_email,
             e.emp_first_name AS added_by_first_name, e.emp_last_name AS added_by_last_name,
             CASE 
               WHEN hm.customer_id IS NOT NULL THEN 'customer'
               WHEN hm.contact_id IS NOT NULL THEN 'contact'
               ELSE 'unknown'
             END AS member_type
      FROM household_member hm
      LEFT JOIN Customer c ON hm.customer_id = c.cus_id
      LEFT JOIN Contact con ON hm.contact_id = con.con_id
      LEFT JOIN Employee e ON hm.added_by = e.emp_id
      WHERE hm.household_member_id = ${household_member_id}
    `;
    
    const members = await DBSendResponse(query);
    if (members && members.length > 0) {
      res.json(members[0]);
    } else {
      res.status(404).json({ code: 404, message: 'Household member not found' });
    }
  } catch (err) {
    console.error('Error in getHouseholdMemberById:', err);
    res.status(500).json({ code: 500, message: 'Error fetching household member' });
  }
};

// Add member to household
exports.addHouseholdMember = async function (req, res) {
  try {
    // Validate that exactly one of customer_id or contact_id is provided
    if ((req.body.customer_id && req.body.contact_id) || (!req.body.customer_id && !req.body.contact_id)) {
      return res.status(400).json({ 
        code: 400, 
        message: 'Must provide exactly one of customer_id or contact_id' 
      });
    }
    
    const query = `
      INSERT INTO household_member (
        household_id, 
        customer_id, 
        contact_id, 
        date_added,
        added_by,
        last_contacted
      ) VALUES (
        ${req.body.household_id},
        ${req.body.customer_id || 'NULL'},
        ${req.body.contact_id || 'NULL'},
        GETDATE(),
        ${req.body.added_by || 'NULL'},
        ${req.body.last_contacted ? `'${req.body.last_contacted}'` : 'NULL'}
      ); 
      SELECT SCOPE_IDENTITY();
    `;
    
    const result = await DBInsertAndReturn(query);
    
    // Track event in Segment
    if (req.body.emp_id && req.body.company_id) {
      analytics.track({
        userId: String(req.body.emp_id),
        event: 'Household member added',
        context: {
          groupId: req.body.company_id,
        },
        properties: {
          householdId: req.body.household_id,
          memberType: req.body.customer_id ? 'customer' : 'contact',
        },
      });
    }
    
    res.json(result);
  } catch (err) {
    console.error('Error in addHouseholdMember:', err);
    res.status(500).json({ code: 500, message: 'Error adding household member' });
  }
};

// Update household member
exports.updateHouseholdMember = async function (req, res) {
  try {
    // Validate that exactly one of customer_id or contact_id is provided
    if ((req.body.customer_id && req.body.contact_id) || (!req.body.customer_id && !req.body.contact_id)) {
      return res.status(400).json({ 
        code: 400, 
        message: 'Must provide exactly one of customer_id or contact_id' 
      });
    }
    
    const query = `
      UPDATE household_member 
      SET 
        household_id = ${req.body.household_id},
        customer_id = ${req.body.customer_id || 'NULL'},
        contact_id = ${req.body.contact_id || 'NULL'},
        last_contacted = ${req.body.last_contacted ? `'${req.body.last_contacted}'` : 'NULL'}
      WHERE household_member_id = ${req.body.household_member_id}
    `;
    
    const out = await DBUpdate(query);
    if (out == 0) {
      res.json({ code: 500, message: 'Update failed' });
    } else {
      res.json({ code: 200, message: 'Household member updated successfully' });
    }
  } catch (err) {
    console.error('Error in updateHouseholdMember:', err);
    res.status(500).json({ code: 500, message: 'Error updating household member' });
  }
};

// Remove member from household
exports.deleteHouseholdMember = async function (req, res) {
  try {
    const household_member_id = req.query.household_member_id;
    
    // Hard delete since this is a mapping table
    const query = `
      DELETE FROM household_member 
      WHERE household_member_id = ${household_member_id}
    `;
    
    const out = await DBUpdate(query);
    if (out == 0) {
      res.json({ code: 500, message: 'Delete failed' });
    } else {
      res.json({ code: 200, message: 'Household member removed successfully' });
    }
  } catch (err) {
    console.error('Error in deleteHouseholdMember:', err);
    res.status(500).json({ code: 500, message: 'Error removing household member' });
  }
};

// Helper function to get members by customer/contact
exports.getHouseholdsByMember = async function (req, res) {
  try {
    const customer_id = req.query.customer_id;
    const contact_id = req.query.contact_id;
    
    let query = `
      SELECT h.*, hm.household_member_id, hm.date_added AS member_since
      FROM household h
      INNER JOIN household_member hm ON h.household_id = hm.household_id
      WHERE 1=1
    `;
    
    if (customer_id) {
      query += ` AND hm.customer_id = ${customer_id}`;
    } else if (contact_id) {
      query += ` AND hm.contact_id = ${contact_id}`;
    } else {
      return res.status(400).json({ code: 400, message: 'Must provide customer_id or contact_id' });
    }
    
    const households = await DBSendResponse(query);
    res.json(households);
  } catch (err) {
    console.error('Error in getHouseholdsByMember:', err);
    res.status(500).json({ code: 500, message: 'Error fetching households' });
  }
};

// Exported helper functions for internal use
exports.getHouseholdMembersByHouseholdId = async function (household_id) {
  const query = `
    SELECT hm.*,
           c.cus_first_name, c.cus_last_name,
           con.con_first_name, con.con_last_name
    FROM household_member hm
    LEFT JOIN Customer c ON hm.customer_id = c.cus_id
    LEFT JOIN Contact con ON hm.contact_id = con.con_id
    WHERE hm.household_id = ${household_id}
  `;
  return await DBSendResponse(query);
};
