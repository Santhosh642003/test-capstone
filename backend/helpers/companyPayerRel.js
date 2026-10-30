const db = require('../models/indexSQL.js')
const axios = require("axios");
const moment = require('moment')
const { DBinsertSendID, DBinsert, DBUpdate, DBSendResponse, generateInsertSQL, generateUpdateSQL } = require('../queries/commonQueries')
const { generateSQLText } = require('../utils/validation')
const { addcompany } = require('../queries/dependantQueries')
const { CUSTOMERIO_API_KEY, env, CLAIM_MD_API_KEY } = require('../config.js')

const { APIClient, SendEmailRequest } = require("customerio-node");

const client = new APIClient(CUSTOMERIO_API_KEY);

exports.getCompanyPayerRels = async function (req, res) {
    getRelationships(req, res);
}

exports.addCompanyPayerRels = async function (req, res) {
    addRelationships(req, res);
}

exports.updateCompanyPayerRels = async function (req, res) {
    updateRelationships(req, res);
}

exports.deleteCompanyPayerRels = async function (req, res) {
    return res.json({});
}

async function getRelationships (req, res) {
    try {

        let selectQ = `SELECT id, payerId, compId, credId, enrollmentStatus, createdOn, updatedOn, relStartDate, relEndDate, relEnrollmentDate, payerTaxId, conFirstName, conLastName, conDesignation, payerAddrLine1, payerAddrLine2, payerCity, payerZip, payerPhone, 
        (SELECT payer_id, payer_is_active, payer_name, payer_state, claimMd_payerId, prof_claims_supp, inst_claims_supp, dent_claims_supp, remittance_supp, payer_type, secondary_supp, eligibility_supp, workers_comp_supp, attachment_supp FROM payer WHERE payer_id = payerId FOR JSON PATH) AS payerDets, 
        (SELECT cred_id, cred_clientID, cred_clientSecret, cred_con_email, cred_is_active, bus_entity_id, bus_entity_Medicaid_identifier FROM credentials WHERE cred_id = credId FOR JSON PATH) AS credDets
        FROM companyPayerRel 
        WHERE compId = ${req.query.compId}` 

        let relationships = await DBSendResponse(selectQ);

        relationships = relationships.map((row) => {
            return {
                ...row,
                payerDets: row.payerDets ? JSON.parse(row.payerDets)[0] : {},
                credDets: row.credDets ? JSON.parse(row.credDets)[0] : {},
            }
        })

        let defPayerQ = `SELECT payer_id as payerId, payer_is_active, payer_name, payer_state, claimMd_payerId, prof_claims_supp, inst_claims_supp, dent_claims_supp, remittance_supp, payer_type, secondary_supp, eligibility_supp, workers_comp_supp, attachment_supp FROM payer WHERE payer_id IN (SELECT payer_id FROM def_payer_state WHERE payer_state IN (SELECT state_id FROM settings WHERE company_id = ${req.query.compId} AND feature_id = 99))`
        let defPayer = await DBSendResponse(defPayerQ);

        let finalRelList = [...relationships];

        defPayer = defPayer.map((r) => {

            if (!relationships.map((rel) => rel.payerId).includes(r.payerId)) {
                relationships.push({...r, payerDets: r, default_payer: true});
            } else {
                relationships.forEach((rel) => {
                    if (rel.payerId === r.payerId) {
                        rel.default_payer = true;
                    }
                })
            }

            return {
                ...r,
                default_payer: true,
            }
        })

        return res.status(200).json(relationships);

    } catch (error) {
        console.log(error);
        return res.status(400).json({
            error: error,
            message: 'Unable to get payer details for this company! Please try again!',
        })
    }
}

async function addRelationships (req, res) {

    const transaction = new db.Transaction()
    let registration_resp = {

    }
    try {

        console.log(req.body);

        transaction.begin(err => {
            const request = new db.Request(transaction)

            let data = {
                payerId: parseInt(req.body.payerDets.payer_id),
                compId: parseInt(req.body.compId),
                credId: req.body.credId ? parseInt(req.body.credId) : undefined,
                createdBy: parseInt(req.body.createdBy),
                updatedBy: parseInt(req.body.updatedBy),
                enrollmentStatus: req.body.enrollmentStatus ? generateSQLText(req.body.enrollmentStatus, 255, null) : undefined,
                createdOn: `${moment().format('YYYY-MM-DDTHH:mm:ss')}`,
                updatedOn: `${moment().format('YYYY-MM-DDTHH:mm:ss')}`,
                relStartDate: generateSQLText(req.body.relStartDate, 255, null),
                relEndDate: generateSQLText(req.body.relEndDate, 255, null),
                relEnrollmentDate: req.body.relEnrollmentDate ? generateSQLText(relEnrollmentDate, 255, null) : undefined,
                payerTaxId: req.body.payerTaxId ? generateSQLText(req.body.payerTaxId, 255, null) : undefined,
                conFirstName: req.body.conFirstName ? generateSQLText(req.body.conFirstName, 255, null) : undefined,
                conLastName: req.body.conLastName ? generateSQLText(req.body.conLastName, 255, null) : undefined,
                conDesignation: req.body.conDesignation ? generateSQLText(req.body.conDesignation, 255, null) : undefined,
                payerAddrLine1: req.body.payerAddrLine1 ? generateSQLText(req.body.payerAddrLine1, 255, null) : undefined,
                payerAddrLine2: req.body.payerAddrLine2 ? generateSQLText(req.body.payerAddrLine2, 255, null) : undefined,
                payerCity: req.body.payerCity ? generateSQLText(req.body.payerCity, 255, null) : undefined,
                payerZip: req.body.payerZip ? generateSQLText(req.body.payerZip, 255, null) : undefined,
                payerPhone: req.body.payerPhone ? generateSQLText(req.body.payerPhone, 255, null) : undefined,
            }

            console.log("data");

            if (req.body.credDets.cred_clientID) {
                let credData = {
                    cred_clientSecret:  generateSQLText(req.body.credDets.cred_clientSecret,255,null),
                    cred_clientID: generateSQLText(req.body.credDets.cred_clientID,255,null),
                    bus_entity_id: req.body.credDets.bus_entity_id ? generateSQLText(req.body.credDets.bus_entity_id,255,null) : undefined,
                    bus_entity_Medicaid_identifier: req.body.credDets.bus_entity_Medicaid_identifier ? generateSQLText(req.body.credDets.bus_entity_Medicaid_identifier,255,null) : undefined,
                    cred_con_email: req.body.credDets.cred_con_email ? generateSQLText(req.body.credDets.cred_con_email,255,null) : undefined,
                    cred_updatedby_id: parseInt(req.body.createdBy),
                    cred_created_at: `${moment().format('YYYY-MM-DDTHH:mm:ss')}`,
                    cred_updated_at: `${moment().format('YYYY-MM-DDTHH:mm:ss')}`,
                    cred_is_active: 'true',
                    cred_company_id: parseInt(req.body.compId),
                }
                let insertCredQ = generateInsertSQL("credentials", credData) + 'SELECT SCOPE_IDENTITY();';
                request.query(insertCredQ, (err, result) => {
                    if(err) {
                        console.log(err);
                        transaction.rollback(err => {
                            return res.status(400).json({ message: 'Adding payer to company failed!' });
                        })
                    } else {
                        data = {
                            ...data,
                            credId: result.recordset[0][''],
                        }
                        let insertQ = generateInsertSQL("companyPayerRel", data) + 'SELECT SCOPE_IDENTITY();'
                        request.query(insertQ, (error, insertRes) => {

                            if (error) {
                                console.log(error);
                                transaction.rollback(err => {
                                    return res.status(400).json({ message: 'Adding payer to company failed!' });
                                })
                            } else {
                                transaction.commit(err => {
                                    return res.status(200).json({ message: 'Payer added to company successfully!', credId: result.recordset[0][''], relId: insertRes.recordset[0]['']});
                                })
                            }
                        })
                    }
                })
            } else {
                let insertQ = generateInsertSQL("companyPayerRel", data) + 'SELECT SCOPE_IDENTITY();'
                console.log(insertQ);
                request.query(insertQ, async (error, insertRes) => {

                    if (error) {
                        console.log(error);
                        transaction.rollback(err => {
                            return res.status(400).json({ message: 'Adding payer to company failed!' });
                        })
                    } else {
                        try {
                            const compDetsQuery = `Select com_taxid,NPI,com_name from company where com_id = ${req.body.compId}`;
                            let compDets = await DBSendResponse(compDetsQuery);
                            console.log("claim_md_payer_id", req.body.payerDets);
                            const formData = {
                                AccountKey: CLAIM_MD_API_KEY,
                                payerid: String(req.body.payerDets.claimMd_payerId),
                                enroll_type: '1500',
                                prov_taxid: String(compDets[0].com_taxid),
                                prov_npi: String(compDets[0].NPI)
                            };
                            console.log(formData);
                            const claim_resp = await axios.post(`https://svc.claim.md/services/enroll/`, new URLSearchParams(formData).toString(), {
                                headers: {
                                    'Content-Type': 'application/x-www-form-urlencoded',
                                    Accept: 'application/json'
                                }
                            }).then((claim_res) => {
                                console.log(claim_res)
                                registration_resp.claim_resp = claim_res.data;
                            }).catch((claim_err) => {
                                console.log(claim_err)
                                registration_resp.claim_err = claim_err.data;
                            });
                            formData.enroll_type = 'era';
                            const era_resp = await axios.post(`https://svc.claim.md/services/enroll/`, new URLSearchParams(formData).toString(), {
                                headers: {
                                    'Content-Type': 'application/x-www-form-urlencoded',
                                    Accept: 'application/json'
                                }
                            }).then((era_res) => {
                                console.log(era_res)
                                registration_resp.era_resp = era_res.data; 
                            }).catch(era_err => {
                                console.log(era_err)
                                registration_resp.era_err = era_err.data;
                            });
                            let display_url = "";
                            if (registration_resp.claim_resp.link) {
                                display_url += `<a href="${registration_resp.claim_resp.link[0].url}">1500 Claim Registration</a><br>`
                            }
                            if (registration_resp.era_resp.link) {
                                display_url += `<a href="${registration_resp.era_resp.link[0].url}">ERA Registration</a><br>`
                            }
                            const request = new SendEmailRequest({
                                transactional_message_id: "claimmd_enrollment",
                                message_data: {
                                  company_name: compDets[0].com_name,
                                  payer_name: req.body.payerDets.payer_name,
                                  payer_id: req.body.payerDets.payer_id,
                                  display_url: display_url,
                                },
                                identifiers: {
                                  id: req.body.createdBy,
                                },
                                to: "support@fieldworker.ai",
                                subject: `${compDets[0].com_name} just added a new payer`,
                            });
                            
                            client.sendEmail(request)
                                .then(res => console.log(res))
                                .catch(err => console.log(err.statusCode, err.message))
                            transaction.commit(async err => {
                                return res.status(200).json({ message: 'Payer added to company successfully!', relId: insertRes.recordset[0][''], registration_resp: registration_resp});
                            })
                        } catch (error) {
                            transaction.rollback(err => {
                                return res.status(400).json({ message: 'Adding payer to company failed!', error: error, registration_resp: registration_resp });
                            })
                        }
                        
                    }
                })
            }
        })

    } catch (error) {
        console.log(error);
        return res.status(400).json({
            error: error,
            message: 'Linking payer to the company failed! Please try again!',
        })
    }

}

async function updateRelationships (req, res) {

    try {

        console.log(req.body);

        let data = {
            relStartDate: req.body.relStartDate,
            relEndDate: req.body.relEndDate,
            payerAddrLine1: req.body.payerAddrLine1 ? generateSQLText(req.body.payerAddrLine1) : undefined,
            payerAddrLine2: req.body.payerAddrLine2 ? generateSQLText(req.body.payerAddrLine2) : undefined,
            payerCity: req.body.payerCity ? generateSQLText(req.body.payerCity) : undefined,
            payerPhone: req.body.payerPhone ? generateSQLText(req.body.payerPhone) : undefined,
            payerTaxId: req.body.payerTaxId ? generateSQLText(req.body.payerTaxId) : undefined,
            payerZip: req.body.payerZip ? generateSQLText(req.body.payerZip) : undefined,
            conFirstName: req.body.conFirstName ? generateSQLText(req.body.conFirstName) : undefined,
            conLastName: req.body.conLastName ? generateSQLText(req.body.conLastName) : undefined,
            conDesignation: req.body.conDesignation ? generateSQLText(req.body.conDesignation) : undefined,
            updatedOn: `${moment().format('YYYY-MM-DDTHH:mm:ss')}`,
        }

        let query = generateUpdateSQL('companyPayerRel', data, `payerId = ${req.body.payerId} AND compId = ${req.body.compId}`);

        const rowsAffected = await DBUpdate(query);
        if (rowsAffected > 0) {
            res.status(200).json({
                status: 'Payer relationship updated successfully',
            })
        } else {
            res.status(400).json({
                status: 'Update failed! Please try again!',
            })
        }

    } catch (error) {
        console.log(error);
        return res.status(400).json({
            error: error,
            message: 'Update failed! Please try again!',
        })
    }

}

async function deleteRelationships (req, res) {

    try {

    } catch (error) {
        console.log(error);
        return res.status(400).json({
            error: error,
            message: 'Delete failed! Please try again!',
        })
    }

}