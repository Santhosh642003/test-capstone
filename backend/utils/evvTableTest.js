var { getReadyVisits, getUpdateVisits } = require("./evvGet.js")

async function tryThis() {
    var result = await getReadyVisits()
    //var result = await getUpdateVisits()
    console.log(result)
}
tryThis()