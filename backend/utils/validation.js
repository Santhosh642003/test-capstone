exports.isActualText = function (text) {
    if(text !== undefined && text !== null && text !== ''){
        return true;
    }
    return false;
}

exports.parseSQLText = function (text, maxLength = 256) {
    let modifiedText = text.replace(/'/g, "''");
    if (modifiedText.length > maxLength) {
        modifiedText = modifiedText.substring(0, maxLength);
    }
    return modifiedText;
}

exports.generateSQLText = function (text, maxLength = 256, defaultValue) {
    if(exports.isActualText(text)){
        return exports.parseSQLText(text, maxLength)
    }
    return defaultValue
}