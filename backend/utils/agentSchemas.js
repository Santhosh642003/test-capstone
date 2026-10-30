const Joi = require('joi');

// Regular expression for YYYY-MM-DD date format
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

// 2.1 Customer Information + 2.2 Diagnosis Information
const customerSchema = Joi.object({
    customer_id: Joi.string().allow(null, ''),
    first_name: Joi.string().required(),
    last_name: Joi.string().required(),
    dob: Joi.string().pattern(dateRegex).allow(null, '').messages({
        'string.pattern.base': '"dob" must be in YYYY-MM-DD format',
    }),
    age: Joi.number().integer().allow(null),
    gender: Joi.string().allow(null, ''),
    county: Joi.string().allow(null, ''),
    ddd_program_type: Joi.string().allow(null, ''),
    medicaid_id: Joi.string().allow(null, ''),
    medicaid_type: Joi.string().allow(null, ''),
    ddd_status: Joi.string().allow(null, ''),
    primary_diagnosis: Joi.string().allow(null, ''),
    secondary_diagnosis: Joi.array().items(Joi.string()).allow(null)
}).unknown(false); // Reject unknown fields

// 2.3 Provider Company + 2.4 Support Coordination Company
const companySchema = Joi.object({
    company_id: Joi.string().allow(null, ''),
    company_name: Joi.string().required(),
    npi: Joi.string().allow(null, ''),
    street: Joi.string().allow(null, ''),
    city: Joi.string().allow(null, ''),
    state: Joi.string().allow(null, ''),
    zip: Joi.string().allow(null, ''),
    company_role: Joi.string().valid('provider', 'support_coordination').required()
}).unknown(false);

// 2.5 Service Authorization (Preauth)
const preauthSchema = Joi.object({
    customer_id: Joi.string().required(),
    preauth_id: Joi.string().allow(null, ''),
    service_type: Joi.string().allow(null, ''),
    procedure_code: Joi.string().allow(null, ''),
    start_date: Joi.string().pattern(dateRegex).allow(null, '').messages({
        'string.pattern.base': '"start_date" must be in YYYY-MM-DD format',
    }),
    end_date: Joi.string().pattern(dateRegex).allow(null, '').messages({
        'string.pattern.base': '"end_date" must be in YYYY-MM-DD format',
    }),
    prior_auth_number: Joi.string().allow(null, ''),
    total_units: Joi.number().allow(null),
    total_cost: Joi.number().allow(null),
    rate: Joi.number().allow(null),
    unit_type: Joi.string().allow(null, ''),
    frequency: Joi.string().allow(null, ''),
    service_location: Joi.string().allow(null, ''),
    funding_source: Joi.string().allow(null, '')
}).unknown(false);

// 2.6 Customer Goals
const customerGoalSchema = Joi.object({
    customer_id: Joi.string().required(),
    goal_description: Joi.string().required(),
    outcome_number: Joi.alternatives().try(Joi.string(), Joi.number()).allow(null, '')
}).unknown(false);

// 2.7 Customer Needs
const customerNeedItemSchema = Joi.object({
    domain: Joi.string().valid('health', 'support', 'employment').required(),
    description: Joi.string().required()
}).unknown(false);

const customerNeedsSchema = Joi.object({
    customer_id: Joi.string().required(),
    needs: Joi.array().items(customerNeedItemSchema).required()
}).unknown(false);

module.exports = {
    customerSchema,
    companySchema,
    preauthSchema,
    customerGoalSchema,
    customerNeedsSchema
};
