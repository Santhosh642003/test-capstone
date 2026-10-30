const axios = require('axios');
const { GOOGLE_MAPS_API_KEY } = require('../config.js');


exports.queryAddress = async function (req, res) {
  let query = 'https://maps.googleapis.com/maps/api/place/autocomplete/json';
  let queryResponse = await axios.get(query, {
    params: {
      key: GOOGLE_MAPS_API_KEY,
      input: req.query.input,
      types: 'street_address|premise'
    }
  });
  res.json(queryResponse.data);
};

exports.getPlaceDetails = async function (req, res) {
  let query = 'https://maps.googleapis.com/maps/api/place/details/json';
  let queryResponse = await axios.get(query, {
    params: {
      key: GOOGLE_MAPS_API_KEY,
      place_id: req.query.place_id
    }
  });
  res.json(queryResponse.data);
};

exports.getLocationInfo = async function (locationInput) {
  let query = 'https://maps.googleapis.com/maps/api/place/autocomplete/json';
  let queryResponse = await axios.get(query, {
    params: {
      key: GOOGLE_MAPS_API_KEY,
      input: locationInput
    }
  });
    
  const bestPrediction = queryResponse.data.predictions[0];

  let query2 = 'https://maps.googleapis.com/maps/api/place/details/json';
  let queryResponse2 = await axios.get(query2, {
    params: {
      key: GOOGLE_MAPS_API_KEY,
      place_id: bestPrediction.place_id
    }
  });
  return queryResponse2.data;
};

exports.getMapsLocationInfo = async function (req, res) {
  const info = await exports.getLocationInfo(req.query.input);
  res.json(info);
};

exports.getAddressFromLatLon = async function(lat, lon) {
  const query = 'https://maps.googleapis.com/maps/api/geocode/json';
  const response = await axios.get(query, {
    params: {
      latlng: `${lat},${lon}`,
      key: GOOGLE_MAPS_API_KEY
    }
  });
  return response.data;
};