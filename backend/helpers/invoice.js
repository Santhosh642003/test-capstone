const jwt_decode = require('../utils/tokenDecoder.js');
const db = require('../models/indexSQL.js');
const { DBinsertSendID, DBinsert, DBUpdate, DBSendResponse, DBinsertSendResponse } = require('../queries/commonQueries');
const { addTask, addTaskAndReturnId } = require('../queries/dependantQueries');
const { getTaskList } = require('../queries/entityGetQueries');
const moment = require('moment');
const { getCustomersAssociatedAPI } = require('./customers.js');
var { SEGMENT_API_KEY } = require("../config");
const { Analytics } = require('@segment/analytics-node')
const analytics = new Analytics({ writeKey: SEGMENT_API_KEY })
// require('moment/locale/us');

// This is with the where statement
exports.getInvoices = async function (req, res) {
	let company_id = JSON.parse(req.query.comp_id);
	let employee_id = JSON.parse(req.query.emp_id);
	let com_id = req.query.comp_id;

	let associatedCustomers = await getCustomersAssociatedAPI(company_id, employee_id);
	let cus_ids = []
	for (const customer of associatedCustomers) {
		cus_ids.push(customer.cus_id)
	}

	if (com_id && employee_id) {
		analytics.track({
			userId: String(employee_id),
			event: 'EVV Invoice Report Generated',
			context: {
				groupId: com_id,
			},
			properties: {
				companyId: com_id,
			}
		})
		console.log("logged to segment successfully");
	}

	const query = `SELECT invoice_id AS id, CONVERT(varchar, invoice_date, 101) as invoice_date, cus_name, procProcCode, invoice_number, line_item_no, amount
    FROM invoice i, customer c
	WHERE i.line_item_no > 0 AND i.customer_id = c.cus_id AND i.comp_id = ${company_id} AND cus_id in (${(cus_ids && cus_ids.length > 0) ? cus_ids : -1})
    ORDER BY invoice_date DESC, procProcCode ASC, line_item_no ASC;`;

	try {
		let invoiceData = await DBSendResponse(query);
		//console.log(invoiceData);
		invoiceData = invoiceData.map((invoice) => {
			invoiceInfo = {
				id: invoice.id,
				invoice_date: invoice.invoice_date,
				cus_name: invoice.cus_name,
				procProcCode: invoice.procProcCode,
				invoice_number: invoice.invoice_number,
				line_item_no: invoice.line_item_no,
				amount: invoice.amount,
			};
			return invoiceInfo;
		});
		/*
		console.log("Printing invoice data payload");
		console.log(invoiceData);
		console.log(invoiceData.id);
		console.log(invoiceData.length);
		console.log('returning invoice info');
		*/
		res.send(invoiceData);
	}
	catch (e) {
		res.send([])
	}
};

exports.addInvoice = async function (req, res) {
	//TODO
	return 'test';
};

exports.updateInvoice = async function (req, res) {
	//TODO
	return 'test';
};

exports.delInvoice = async function (req, res) {
	//TODO
	return 'test';
};

async function exampleHelperFunction(req, res) {
	return 'Hello World!';
}
