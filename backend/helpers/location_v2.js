const db = require('../models/indexSQL.js')
const { DBinsertSendID, DBinsert, DBUpdate, DBSendResponse, DBinsertSendResponse } = require('../queries/commonQueries')
const { addlocation } = require('../queries/dependantQueries')

exports.getLocation = async function (req, res) {
    let locList = []
    let query = ''

    if(!!req.query.company_id && !!req.query.project_id){
        query = `select * from [dbo].[projectLocation] INNER JOIN location ON projectLocation.ploc_loc_id = location.loc_id where projectLocation.ploc_pro_id=${req.query.project_id} and location.loc_company_id=${req.query.company_id}`
    }

    try{
        const response = await DBSendResponse(query)
        res.status(200).json(response)
    } catch(err){
        res.status(500).json({
            message: 'Error occured while trying to access GET location/v2'
        })
    }
}

