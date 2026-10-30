const { DBInsertAndReturn, DBSendResponse } = require("../queries/commonQueries.js");

exports.getLatestVersions = async function (req, res) {
    let query = `SELECT TOP 5 Version, Title, Description, DeploymentDate
                 FROM WhatsNewUpdates
                 ORDER BY DeploymentDate DESC`;

    let latestVersionInfo = await DBSendResponse(query);
    
    res.json(latestVersionInfo);
};

exports.getLatestVersionsCount = async function (req, res) {
    let query = `SELECT COUNT(*) AS NumberOfVersions
                 FROM WhatsNewUpdates
                 WHERE DeploymentDate >= DATEADD(day, -7, GETDATE())`;

    let updatesCount = (await DBSendResponse(query))[0];
    
    res.json(updatesCount);
};
