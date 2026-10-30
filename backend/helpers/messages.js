const { DBSendResponseParam, DBinsertSendIDParam, DBUpdateParam } = require('../queries/commonQueries');
const moment = require('moment');

// ---------------------------------------------------------------------------
// getPendingMessages
// GET /messages/pending?emp_id=&comp_id=&role=
// Returns messages that have not yet been dismissed by this employee.
// Also lazily creates a delivery record (DISPLAYED) if one does not exist.
// ---------------------------------------------------------------------------
exports.getPendingMessages = async function (req, res) {
    try {
        const emp_id = parseInt(req.query.emp_id, 10);
        const comp_id = parseInt(req.query.comp_id, 10);
        const role = typeof req.query.role === 'string' ? req.query.role : '';

        if (isNaN(emp_id) || isNaN(comp_id)) {
            return res.status(400).json({ message: 'emp_id and comp_id must be valid integers' });
        }

        const messagesQuery = `
            SELECT m.msg_id, m.msg_text, m.msg_source, m.target_roles,
                   m.valid_until, m.comp_id, m.created_at,
                   d.delivery_id, d.status, d.msg_displayed_at
            FROM company_messages m
            LEFT JOIN message_delivery d
                   ON d.msg_id = m.msg_id AND d.emp_id = @emp_id
            WHERE m.is_active = 1
              AND (m.valid_until IS NULL OR m.valid_until >= GETDATE())
              AND (m.msg_source = 'fw_support' OR (m.msg_source = 'company' AND m.comp_id = @comp_id))
              AND (d.delivery_id IS NULL OR d.status != 'DISMISSED')
            ORDER BY m.created_at ASC
        `;

        let messages = await DBSendResponseParam(messagesQuery, { emp_id, comp_id });

        // Filter by role in JS — target_roles is a JSON array stored in DB
        if (role) {
            messages = messages.filter(msg => {
                if (!msg.target_roles) return true;
                try {
                    const roles = JSON.parse(msg.target_roles);
                    return Array.isArray(roles) && roles.map(r => r.toLowerCase()).includes(role.toLowerCase());
                } catch {
                    return true;
                }
            });
        }

        // Lazily create/update delivery records
        const now = moment().toDate();
        for (const msg of messages) {
            if (!msg.delivery_id) {
                const newId = await DBinsertSendIDParam(
                    `INSERT INTO message_delivery (msg_id, emp_id, comp_id, msg_created_at, msg_displayed_at, status)
                     VALUES (@msg_id, @emp_id, @comp_id, @now, @now, 'DISPLAYED');
                     SELECT SCOPE_IDENTITY()`,
                    { msg_id: msg.msg_id, emp_id, comp_id, now }
                );
                msg.delivery_id = newId;
                msg.status = 'DISPLAYED';
                msg.msg_displayed_at = now;
            } else if (msg.status === 'PENDING') {
                await DBUpdateParam(
                    `UPDATE message_delivery
                     SET status = 'DISPLAYED', msg_displayed_at = @now
                     WHERE delivery_id = @delivery_id`,
                    { now, delivery_id: msg.delivery_id }
                );
                msg.status = 'DISPLAYED';
                msg.msg_displayed_at = now;
            }
        }

        return res.status(200).json(messages);
    } catch (err) {
        console.error('/messages/pending GET ERROR:', err.message);
        return res.status(500).json({ message: 'Server error' });
    }
};

// ---------------------------------------------------------------------------
// createMessage
// POST /messages
// Body: { msg_text, msg_source, target_roles (array|null), valid_until (ISO string|null),
//         comp_id (null for fw_support), created_by }
// Inserts the message then fans out delivery records to all matching employees.
// ---------------------------------------------------------------------------
exports.createMessage = async function (req, res) {
    try {
        const { msg_text, msg_source, target_roles, valid_until, comp_id, created_by } = req.body;

        if (!msg_text || !msg_source) {
            return res.status(400).json({ message: 'msg_text and msg_source are required' });
        }
        if (!['company', 'fw_support'].includes(msg_source)) {
            return res.status(400).json({ message: "msg_source must be 'company' or 'fw_support'" });
        }

        const compIdInt = comp_id ? parseInt(comp_id, 10) : null;
        const createdByInt = created_by ? parseInt(created_by, 10) : null;
        if (comp_id && isNaN(compIdInt)) return res.status(400).json({ message: 'Invalid comp_id' });
        if (created_by && isNaN(createdByInt)) return res.status(400).json({ message: 'Invalid created_by' });

        const validUntilDate = valid_until ? new Date(valid_until) : null;
        if (valid_until && isNaN(validUntilDate?.getTime())) {
            return res.status(400).json({ message: 'Invalid valid_until date' });
        }

        const targetRolesJson = (target_roles && target_roles.length > 0)
            ? JSON.stringify(target_roles)
            : null;

        const now = moment().toDate();

        const msg_id = await DBinsertSendIDParam(
            `INSERT INTO company_messages (msg_text, msg_source, target_roles, valid_until, comp_id, created_by, created_at, is_active)
             VALUES (@msg_text, @msg_source, @target_roles, @valid_until, @comp_id, @created_by, @now, 1);
             SELECT SCOPE_IDENTITY()`,
            {
                msg_text,
                msg_source,
                target_roles: targetRolesJson,
                valid_until: validUntilDate,
                comp_id: compIdInt,
                created_by: createdByInt,
                now,
            }
        );

        if (!msg_id) {
            return res.status(500).json({ message: 'Failed to create message' });
        }

        return res.status(200).json({ message: 'Message created', msg_id });
    } catch (err) {
        console.error('/messages POST ERROR:', err.message);
        return res.status(500).json({ message: 'Server error' });
    }
};

// ---------------------------------------------------------------------------
// dismissMessage
// PUT /messages/delivery/:delivery_id
// Marks a delivery record as DISMISSED with a timestamp.
// ---------------------------------------------------------------------------
exports.dismissMessage = async function (req, res) {
    try {
        const delivery_id = parseInt(req.params.delivery_id, 10);
        if (isNaN(delivery_id)) return res.status(400).json({ message: 'Invalid delivery_id' });

        const result = await DBUpdateParam(
            `UPDATE message_delivery
             SET status = 'DISMISSED', msg_dismissed_at = @now
             WHERE delivery_id = @delivery_id`,
            { now: moment().toDate(), delivery_id }
        );

        if (result !== 0) {
            return res.status(200).json({ message: 'Dismissed' });
        } else {
            return res.status(404).json({ message: 'Delivery record not found' });
        }
    } catch (err) {
        console.error('/messages/delivery/:delivery_id PUT ERROR:', err.message);
        return res.status(500).json({ message: 'Server error' });
    }
};

// ---------------------------------------------------------------------------
// getCompanyMessages
// GET /messages?comp_id=
// Returns all active messages for a given company (for Settings listing).
// ---------------------------------------------------------------------------
exports.getCompanyMessages = async function (req, res) {
    try {
        const comp_id = parseInt(req.query.comp_id, 10);
        if (isNaN(comp_id)) return res.status(400).json({ message: 'comp_id must be a valid integer' });

        const messages = await DBSendResponseParam(
            `SELECT msg_id, msg_text, msg_source, target_roles, valid_until, comp_id, created_by, created_at, is_active
             FROM company_messages
             WHERE is_active = 1
               AND (comp_id = @comp_id OR msg_source = 'fw_support')
             ORDER BY created_at DESC`,
            { comp_id }
        );
        return res.status(200).json(messages);
    } catch (err) {
        console.error('/messages GET ERROR:', err.message);
        return res.status(500).json({ message: 'Server error' });
    }
};

// ---------------------------------------------------------------------------
// deactivateMessage
// PUT /messages/:msg_id/deactivate
// Soft-deletes a message (sets is_active = 0).
// ---------------------------------------------------------------------------
exports.deactivateMessage = async function (req, res) {
    try {
        const msg_id = parseInt(req.params.msg_id, 10);
        if (isNaN(msg_id)) return res.status(400).json({ message: 'Invalid msg_id' });

        const result = await DBUpdateParam(
            `UPDATE company_messages SET is_active = 0 WHERE msg_id = @msg_id`,
            { msg_id }
        );

        if (result !== 0) {
            return res.status(200).json({ message: 'Message deactivated' });
        } else {
            return res.status(404).json({ message: 'Message not found' });
        }
    } catch (err) {
        console.error('/messages/:msg_id/deactivate PUT ERROR:', err.message);
        return res.status(500).json({ message: 'Server error' });
    }
};
