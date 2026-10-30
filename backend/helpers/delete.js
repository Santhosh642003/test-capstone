const db = require('../models/indexSQL.js')
const { DBUpdate } = require('../queries/commonQueries')

exports.deleteOne = function (req, res) {
  console.log(req.params.table)
  switch (req.params.table) {
    case 'projects':
      delOneProject(req, res)
      break
    case 'employees':
      delOneEmployee(req, res)
      break
    case 'customers':
      delOneCustomer(req, res)
      break
    case 'contacts':
      delOneContact(req, res)
      break
    case 'locations':
      delOneLocation(req, res)
      break
    case 'tasks':
      delOneTask(req, res)
      break
    case 'artifacts':
      break
    default:
      res.send('error')
      break
  }
}

// add to project helper
async function delOneProject (req, res) {
  const booleanValue = req.body.bval
  const id = req.body.id
  const query = `UPDATE project SET pro_is_active = '${booleanValue}' WHERE pro_id = ${id}`
  const out = await DBUpdate(res, query)
  if (out == 0) {
    res.json({ code: 500, message: 'Update failed' })
  } else {
    res.json({ code: 200, message: 'Update Success' })
  }
}
// add to employee helper
async function delOneEmployee (req, res) {
  const booleanValue = req.body.bval
  const id = req.body.id
  const query = `UPDATE employee SET emp_is_active = '${booleanValue}' WHERE emp_id = ${id}`
  const out = await DBUpdate(res, query)
  if (out == 0) {
    res.json({ code: 500, message: 'Update failed' })
  } else {
    res.json({ code: 200, message: 'Update Success' })
  }
}
// add to customer helper
async function delOneCustomer (req, res) {
  const booleanValue = req.body.bval
  const id = req.body.id
  const query = `UPDATE customer SET cus_is_active = '${booleanValue}' WHERE cus_id = ${id}`
  const out = await DBUpdate(res, query)
  if (out == 0) {
    res.json({ code: 500, message: 'Update failed' })
  } else {
    res.json({ code: 200, message: 'Update Success' })
  }
}
// add to contact helper
async function delOneContact (req, res) {
  const booleanValue = req.body.bval
  const id = req.body.id
  const query = `UPDATE contact SET con_is_active = '${booleanValue}' WHERE con_id = ${id}`
  const out = await DBUpdate(res, query)
  if (out == 0) {
    res.json({ code: 500, message: 'Update failed' })
  } else {
    res.json({ code: 200, message: 'Update Success' })
  }
}

// add to location helper

async function delOneLocation (req, res) {
  const booleanValue = req.body.bval
  const id = req.body.id
  const query = `UPDATE location SET loc_is_active = '${booleanValue}' WHERE loc_id = ${id}`
  const out = await DBUpdate(res, query)
  if (out == 0) {
    res.json({ code: 500, message: 'Update failed' })
  } else {
    res.json({ code: 200, message: 'Update Success' })
  }
}

// add to task helper

async function delOneTask (req, res) {
  // var booleanValue=req.body.bval;
  const id = req.body.id
  const query = `UPDATE task SET tas_is_active = 2 WHERE tas_id = ${id}`
  const out = await DBUpdate(res, query)
  if (out === 0) {
    res.json({ code: 500, message: 'Update failed' })
  } else {
    res.json({ code: 200, message: 'Update Success' })
  }
}

// async function DBUpdate(res, query) {
// 	var request = new db.Request();
// 	let out = await request.query(query).then((result)=>{return result}).catch((err)=>{console.log(err)});
// 	console.log(out);
// 	return out.rowsAffected[0];
// }
