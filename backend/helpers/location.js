const db = require('../models/indexSQL.js');
const { DBinsertSendID, DBinsert, DBUpdate, DBSendResponse, DBinsertSendResponse } = require('../queries/commonQueries');
const { addlocation } = require('../queries/dependantQueries');

const getProgramIdFromReq = (req) => {
  const parsed = parseInt(req.query.program_id, 10);
  return Number.isInteger(parsed) ? parsed : null;
};

const filterLocationsByProgram = async (locations, programId) => {
  if (!programId || !Array.isArray(locations) || locations.length === 0) {
    return locations;
  }

  const locationIds = locations
    .map((loc) => Number(loc.loc_id))
    .filter((locId) => Number.isInteger(locId));

  if (locationIds.length === 0) {
    return [];
  }

  const allowed = await DBSendResponse(
    `SELECT entity_id FROM program_association WHERE program_id = ${programId} AND entity_type = 'location' AND entity_id IN (${locationIds.map((id) => `'${id}'`).join(',')})`
  );
  const allowedIds = new Set(allowed.map((row) => Number(row.entity_id)));

  return locations.filter((loc) => allowedIds.has(Number(loc.loc_id)));
};

exports.getLocTables = async function (req, res) {
  console.log(req.query);
  // console.log('..')
  let locList = [];

  if (req.query.loc_id) {
    locList = await getLocationList(req.query.loc_id);
  } else if (req.query.loc_type) {
    locList = await getLocationType(req.query.loc_type);
  } else if (req.query.loc_status) {
    locList = await getLocationStatus(req.query.loc_status);
  } else {
    locList = await getLocationAllList();
  }

  if (req.query.comp_id) {
    locList = locList.filter((loc) => loc.loc_company_id === +req.query.comp_id);
  }
  locList = await filterLocationsByProgram(locList, getProgramIdFromReq(req));
  if (!!req.query.lastN && locList.length > +req.query.lastN) {
    locList = locList.slice(Math.max(locList.length - +req.query.lastN, 0));
  }
  res.json(locList);
};

exports.getLocationIdbyAddress = async function (req, res) {
  console.log(req.query);
  const query = `SELECT * FROM location where loc_addr_line1 = '${req.query.address_line_1}' and loc_addr_line2 = '${req.query.address_line_2}' and loc_city = '${req.query.city}' and loc_state = '${req.query.state}' and loc_zip = '${req.query.zip}'`;
  console.log(query);
  const out = await DBSendResponse(query);
  res.json(out);
};

exports.addOnelocation = async function (req, res) {
  addlocation(req, res, sendId = false);
};

exports.updateLocation = async function (req, res) {
  updateOneLocation(req, res);
};

exports.deleteLocation = async function (req, res) {
  delOneLocation(req, res);
};

async function getLocationAllList () {
  const query = 'SELECT * FROM location';
  console.log(query);
  const out = await DBSendResponse(query);
  return out;
}
async function getLocationList (id) {
  const query = `SELECT * FROM location 
				WHERE loc_id = ${id}`;
  console.log(query);
  const out = await DBSendResponse(query);
  return out;
}

async function getLocationType (type) {
  const query = `SELECT * FROM location 
				WHERE loc_type = '${type}'`;
  console.log(query);
  let out = [];
  out = await DBinsertSendResponse(query);
  return out;
}

async function getLocationStatus (status) {
  const query = `SELECT * FROM location 
				WHERE loc_status = '${status}'`;

  let out = [];
  out = await DBinsertSendResponse(query);
  console.log(out);
  return out;
}

async function updateOneLocation (req, res) {
  const query = `UPDATE location 
				SET 
					loc_addr_line1='${req.address_line_1}',
					loc_addr_line2='${req.address_line_2}',
					loc_city='${req.city}',
					loc_state='${req.state}',
					loc_zip='${req.zip}',
					loc_lat=${req.latitude},
					loc_lon=${req.longitude},
					loc_is_active='true',
					loc_phone_number='${req.body.phonList.split(',')[0]}'
				WHERE loc_id = ${req.updtLocId}`;
  console.log(query);
  const out = await DBUpdate(query);
  if (out == 0) {
    res.json({ code: 500, message: 'Update failed' });
  } else {
    res.json({ code: 200, message: 'Update Success' });
  }
}

async function delOneLocation (req, res) {
  const booleanValue = req.body.bval;
  const id = req.body.id;
  const query = `UPDATE location SET loc_is_active = '${booleanValue}' WHERE loc_id = ${id}`;
  const out = await DBUpdate(query);
  if (out == 0) {
    res.json({ code: 500, message: 'Update failed' });
  } else {
    res.json({ code: 200, message: 'Update Success' });
  }
}
