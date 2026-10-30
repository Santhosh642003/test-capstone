const moment = require('moment')
const db = require('../models/indexSQL.js')
const { DBinsertSendID, DBinsert, DBUpdate, DBSendResponse, DBinsertSendResponse } = require('../queries/commonQueries')
const { isActualText, parseSQLText, generateSQLText } = require('../utils/validation')
const { translate } = require('@vitalets/google-translate-api');

var { SEGMENT_API_KEY } = require("../config");
const { Analytics } = require('@segment/analytics-node')
const analytics = new Analytics({ writeKey: SEGMENT_API_KEY })

exports.getRelationships = async function (req, res) {
    const query = `Select t.*, f.form_name, f.json_schema, f.translated_json_schema, f.ui_schema from task_form t INNER JOIN fw_forms f ON t.form_id = f.form_id WHERE t.taskType_id=${req.query.taskType_id} AND t.company_id=${req.query.company_id}`
    const result = await DBSendResponse(query)

    res.json(result)
}

exports.postRelationships = async function (req, res) {
    const transaction = new db.Transaction()

    transaction.begin(err => {
        const request = new db.Request(transaction)

        request.query(`DELETE FROM task_form WHERE taskType_id=${req.body.taskType_id} AND company_id=${req.body.company_id}`, (err, result) => {
            if (err) {
                console.log(err)
                transaction.rollback(err => {
                    res.json({ code: 500, message: 'Relationships not created' })
                })
            } else {
                if (req.body.form_ids.length === 0) {
                    if (req.body.created_by && req.body.company_id && req.body.taskType_id) {
                        analytics.track({
                            userId: String(req.body.created_by),
                            event: 'Task forms updated',
                            context: {
                                groupId: req.body.company_id,
                            },
                            properties: {
                                formIds: "all forms unlinked",
                                taskTypeId: req.body.taskType_id
                            }
                        })
                    }
                    transaction.commit(err => {
                        res.json({ code: 200, message: 'Relationships created' })
                    })
                    return;
                }
                let query = `INSERT INTO task_form (taskType_id, form_id, status, company_id, created_on, created_by) VALUES`

                req.body.form_ids.forEach((form_id, index) => {
                    query += `(${req.body.taskType_id}, ${form_id}, 1, ${req.body.company_id}, CURRENT_TIMESTAMP, ${req.body.created_by})`
                    if (index < req.body.form_ids.length - 1) {
                        query += ','
                    }
                })
                console.log(query);
                request.query(query, (err, result) => {
                    if (err) {
                        console.log(err)
                        transaction.rollback(err => {
                            res.json({ code: 500, message: 'Relationships not created' })
                        })
                    } else {
                        if (req.body.created_by && req.body.company_id && req.body.taskType_id && req.body.form_ids) {
                            analytics.track({
                                userId: String(req.body.created_by),
                                event: 'Task forms updated',
                                context: {
                                    groupId: req.body.company_id,
                                },
                                properties: {
                                    formIds: req.body.form_ids.join(),
                                    taskTypeId: req.body.taskType_id
                                }
                            })
                        }
                        transaction.commit(err => {
                            res.json({ code: 200, message: 'Relationships created' })
                        })
                    }
                })
            }
        })
    })
}

exports.getForms = async function (req, res) {
    const query = `Select * from fw_forms`
    const result = await DBSendResponse(query)


    res.json(result)
}

exports.getForm = async function (req, res) {
    const query = `Select * from fw_forms WHERE form_id=${req.query.form_id}`
    const result = await DBSendResponse(query)

    console.log(req.query);

    res.json(result)
}

exports.getSubscribedForms = async function (req, res) {
    const query = `Select s.*, f.form_name, f.form_description, f.form_added_on, f.form_added_by, f.form_type, f.json_schema, f.translated_json_schema, f.ui_schema, f.form_company, f.public_form from subscribed_form s INNER JOIN fw_forms f ON s.form_id = f.form_id WHERE s.company_id=${req.query.company_id}`
    const result = await DBSendResponse(query)

    res.json(result)
}

exports.postSubscribedForms = async function (req, res) {
    const query = `INSERT INTO subscribed_form (company_id, form_id, created_on, created_by) VALUES (${req.body.company_id}, ${req.body.form_id}, CURRENT_TIMESTAMP, ${req.body.created_by}); SELECT SCOPE_IDENTITY();`
    const result = await DBinsertSendResponse(query)

    if (result) {
        if (req.body.created_by && req.body.company_id && req.body.form_id) {
            analytics.track({
                userId: String(req.body.created_by),
                event: 'Form subscribed',
                context: {
                    groupId: req.body.company_id,
                },
                properties: {
                    formId: req.body.form_id
                }
            })
        }
        res.json({ code: 200, message: 'Form subscribed successfully' })
    } else {
        res.json({ code: 400, message: 'Error subscribing form' })
    }
}

exports.deleteSubscribedForms = async function (req, res) {
    const transaction = new db.Transaction()

    transaction.begin(err => {
        const request = new db.Request(transaction)

        request.query(`DELETE FROM subscribed_form WHERE company_id=${req.body.company_id} AND form_id=${req.body.form_id}`, (err, result) => {
            if (err) {
                console.log(err)
                transaction.rollback(err => {
                    res.json({ code: 500, message: 'Error unsubscribing form' })
                })
            } else {
                request.query(`DELETE FROM task_form WHERE form_id=${req.body.form_id} AND company_id=${req.body.company_id}`, (err, result) => {
                    if (err) {
                        console.log(err)
                        transaction.rollback(err => {
                            res.json({ code: 500, message: 'Error unsubscribing form' })
                        })
                    } else {
                        if (req.body.deleted_by && req.body.company_id && req.body.form_id) {
                            analytics.track({
                                userId: String(req.body.deleted_by),
                                event: 'Form unsubscribed',
                                context: {
                                    groupId: req.body.company_id,
                                },
                                properties: {
                                    formId: req.body.form_id,
                                }
                            })
                        }
                        transaction.commit(err => {
                            res.json({ code: 200, message: 'Form unsubscribed successfully' })
                        })
                    }
                })
            }
        })
    })
}

exports.getMaxFormID = async function (req, res) {
    const query = `SELECT MAX(form_id) FROM fw_forms`;
    const result = await DBSendResponse(query);

    res.json(result);
}

exports.addForm = async function (req, res) {
    let targetLang = req.body.form_language;
    const formSchema = JSON.parse(JSON.stringify(req.body.json_schema));

    const translatedSchema = targetLang ? await translateSchema(formSchema, targetLang) : null;

    if (!translatedSchema) {
        targetLang = '';
    }

    const query = `INSERT INTO fw_forms (form_id, form_name, form_description, form_added_on, form_added_by, form_type, json_schema, form_company, public_form, form_language, translated_json_schema) 
    VALUES (
        ${req.body.form_id}, 
        '${req.body.form_name.replaceAll("'", "''")}', 
        '${req.body.form_description.replaceAll("'", "''")}', 
        CURRENT_TIMESTAMP, 
        ${req.body.form_added_by}, 
        '${req.body.form_type.replaceAll("'", "''")}', 
        '${JSON.stringify(req.body.json_schema).replaceAll("'", "''")}', 
        ${req.body.form_company}, 
        ${req.body.public_form},
        '${targetLang.replaceAll("'", "''")}',
        ${translatedSchema ? `'${JSON.stringify(translatedSchema).replaceAll("'", "''")}'` : 'NULL'}
    );`;
    const result = await DBSendResponse(query);
    if (req.body.form_added_by && req.body.form_company && req.body.form_id && req.body.form_name) {
        analytics.track({
            userId: String(req.body.form_added_by),
            event: 'Form added',
            context: {
                groupId: req.body.form_company,
            },
            properties: {
                formId: req.body.form_id,
                formName: req.body.form_name.replaceAll("'", "''"),
            }
        })
        console.log("logged to segment successfully");
    }

    if (result) {
        res.json({ code: 200, message: 'Form added successfully' });
    } else {
        res.json({ code: 400, message: 'Error adding form' });
    }
}

exports.editForm = async function (req, res) {
    let targetLang = req.body.form_language;
    const formSchema = JSON.parse(JSON.stringify(req.body.json_schema));

    const translatedSchema = targetLang ? await translateSchema(formSchema, targetLang) : null;

    if (!translatedSchema) {
        targetLang = '';
    }

    const query = `UPDATE fw_forms 
    SET 
        form_name = '${req.body.form_name.replaceAll("'", "''")}', 
        json_schema = '${JSON.stringify(req.body.json_schema).replaceAll("'", "''")}', 
        form_language = '${targetLang.replaceAll("'", "''")}',
        translated_json_schema = ${translatedSchema ? `'${JSON.stringify(translatedSchema).replaceAll("'", "''")}'` : 'NULL'},
        public_form = ${req.body.public_form} 
    WHERE form_id = ${req.body.form_id}`;
    const result = await DBSendResponse(query);

    if (result) {
        res.json({ code: 200, message: 'Form edited successfully' });
    } else {
        res.json({ code: 400, message: 'Error editing form' });
    }
}

exports.deleteForm = async function (req, res) {
    const query = `UPDATE fw_forms SET form_status = 2 WHERE form_id = ${req.body.form_id}`;
    const result = await DBSendResponse(query);

    if (result) {
        res.json({ code: 200, message: 'Form delete successfully' });
    } else {
        res.json({ code: 400, message: 'Error deleting form' });
    }
}

async function batchTranslate(texts, targetLang) {
    const delimiter = ' ||| ';

    const joined = texts.join(delimiter);
    try {
        const { text } = await translate(joined, {
            to: targetLang
        });

        return text.split(delimiter).map(t => t.trim());
    } catch (e) {
        console.error("Translation error:", e);
        return [];
    }
}

async function translateSchema(schema, targetLang) {
    const allLabels = [];

    function collectLabels(component) {
        if (component.label) allLabels.push(component.label);

        if (component.description) allLabels.push(component.description);

        if (Array.isArray(component.values)) {
            component.values.forEach(v => v.label && allLabels.push(v.label));
        }

        if (Array.isArray(component.data?.values)) {
            component.data.values.forEach(v => v.label && allLabels.push(v.label));
        }

        if (Array.isArray(component.components)) {
            component.components.forEach(collectLabels);
        }
    }

    schema.components.forEach(collectLabels);

    // Translate all labels in one go
    const translatedLabels = await batchTranslate(allLabels, targetLang);

    if (translatedLabels.length !== allLabels.length) {
        console.error("Mismatch in number of translated labels");
        return null;
    }

    // Iterator to consume translated labels in order
    let i = 0;
    function applyTranslations(component) {
        if (component.label) component.label = translatedLabels[i++];

        if (component.description) component.description = translatedLabels[i++];

        if (Array.isArray(component.values)) {
            component.values.forEach(v => {
                if (v.label) v.label = translatedLabels[i++];
            });
        }

        if (Array.isArray(component.data?.values)) {
            component.data.values.forEach(v => {
                if (v.label) v.label = translatedLabels[i++];
            });
        }

        if (Array.isArray(component.components)) {
            component.components.forEach(applyTranslations);
        }
    }

    schema.components.forEach(applyTranslations);

    return schema;
}