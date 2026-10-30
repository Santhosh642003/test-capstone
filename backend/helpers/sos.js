const db = require("../models/indexSQL.js");
const { DBSendResponse } = require("../queries/commonQueries.js");
const { CUSTOMERIO_API_KEY, env } = require('../config.js')
const { APIClient, SendPushRequest } = require("customerio-node");
const client = new APIClient(CUSTOMERIO_API_KEY);

exports.sendPush = async (req, res) => {
    let finalIds;

    let settings = await DBSendResponse(`SELECT * FROM settings WHERE company_id = ${req.body.comId}`);
    let isSecureCommunicaion = settings.find(setting => setting.feature_id === 21);
    let isSOSEnabled = settings.find(setting => (setting.feature_id === 67 && setting.feature_value === 'true'));

    if (!isSecureCommunicaion || !isSOSEnabled) {
        return res.json({
            status: 'not sent',
            error: 'Secure Communication or SOS is not enabled!',
        })
    }

    const getSOSEligible = `SELECT emp_id FROM employee WHERE emp_sos_status = 1 AND emp_company_id = ${req.body.comId}`;
    const SOSEligResp = await DBSendResponse(getSOSEligible);
    finalIds = SOSEligResp;

    if (SOSEligResp.length === 0) {
        const getAdmins = `SELECT emp_id FROM employee WHERE emp_type = 'Admin' AND emp_company_id = ${req.body.comId}`;
        let adminResp = await DBSendResponse(getAdmins);
        finalIds = adminResp;
    }

    try {
        finalIds.forEach(async (obj) => {
            const request = new SendPushRequest({
                transactional_message_id: "sos_push",
                message_data: {
                    address: req.body.address,
                    name: req.body.empName,
                },
                identifiers: {
                    id: obj.emp_id,
                },
            });

            await client.sendPush(request)
                .then((res) => console.log(res))
                .catch((err) => {
                    console.log(err.statusCode, err.message);
                    res.json({ status: 'not sent', error: err }
                    )
                });
        });
        res.json({
            status: 'sent',
        })
    } catch (error) {
        console.log(error)
        res.json({
            status: 'not sent',
            error: error,
        })
    }

}