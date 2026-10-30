const { DBinsertSendResponse } = require('../queries/commonQueries');

const escapeLike = (s) => String(s).replace(/'/g, "''").replace(/[\[\]%_]/g, (m) => `[${m}]`);

exports.globalSearch = async function (req, res) {
    try {
        const compId = parseInt(req.query.comp_id, 10);
        const empId = req.query.emp_id ? parseInt(req.query.emp_id, 10) : null;
        const rawQ = (req.query.q || '').trim();
        if (!compId || rawQ.length < 2) {
            return res.status(200).json({ customers: [], projects: [], tasks: [] });
        }
        const limit = Math.min(parseInt(req.query.limit, 10) || 5, 10);
        const term = `%${escapeLike(rawQ)}%`;

        const customerQ = `select top ${limit} cus_id, cus_name
            from customer
            where cus_company_id=${compId} and cus_name like '${term}'
            order by cus_name asc`;

        const projectQ = `select top ${limit} pro_id, pro_title, pro_customer_id as cus_id
            from project
            where pro_com_id=${compId} and pro_title like '${term}'
            order by pro_title asc`;

        const contactQ = `select top ${limit} c.con_id,
            CONCAT(c.con_first_name, ' ', c.con_last_name) as contact_name,
            c.con_phone, c.con_designation,
            p.pro_id, p.pro_customer_id as cus_id, p.pro_title
            from contact c
            join ProjectContact pc on c.con_id = pc.cont_id
            join project p on pc.proj_id = p.pro_id
            where c.con_company_id = ${compId}
              and c.con_is_active = 'true'
              and p.pro_ends_on >= GETDATE()
              and (c.con_first_name like '${term}'
                or c.con_last_name like '${term}'
                or CONCAT(c.con_first_name, ' ', c.con_last_name) like '${term}')
            order by c.con_last_name, c.con_first_name`;

        const [customers, projects, contacts] = await Promise.all([
            DBinsertSendResponse(customerQ),
            DBinsertSendResponse(projectQ),
            DBinsertSendResponse(contactQ),
        ]);

        res.status(200).json({ customers, projects, contacts });
    } catch (err) {
        console.error('globalSearch error', err);
        res.status(500).json({ customers: [], projects: [], tasks: [], error: 'Search failed' });
    }
};
