const db = require('../models/indexSQL.js')
const { DBinsertSendID, DBUpdate, DBSendResponse, DBinsert } = require('../queries/commonQueries')
const { getContactList, getCustomerList, getEmployeeList, getLocationList, getProjectList, getTaskList, getTaskListv2 } = require('../queries/entityGetQueries')
const { enhancedTypeDD,enhancedContactTypeDD,enhancedEmpTypeDD,enhancedEmpStatusDD,enhancedlocTypeDD,enhancedCustomerTypeDD,enhancedModuleDD,enhancedStatesDD,enhancedtaskTypeDD,empLevelDD, empTypeDD, empStatusDD, currencyDD, frequencyDD, customerTypeDD, customerStatusDD, designationDD, contactStatusDD, contactTypeDD, statesDD, locStatusDD, locTypeDD, taskTypeDD, fullTaskTypeDD } = require('../queries/dropdownQueries')
let csc = require('country-state-city').default
const yaml = require('js-yaml');
const fs = require('fs');
const simpleGit = require('simple-git');
const path = require('path');
const { AUTH_POLICY_REPO_URL, env } = require('../config.js')
const GIT_URL = AUTH_POLICY_REPO_URL;
const LOCAL_PATH = path.join(__dirname, 'repo-clone');

async function getConfiguredGit() {
  const git = simpleGit(LOCAL_PATH);
  await git.addConfig('user.email', 'info@analytiq.us');
  await git.addConfig('user.name', 'fw-auth-service');
  return git;
}

exports.getStates = async function(req,res){
    let states = await csc.getStatesOfCountry('US')
    let cities = await csc.getCitiesOfCountry('US')
    // console.log(csc)
    res.json({states, cities})
}

exports.getStatesv2 = async function(req,res){
    let states = [{"name":"Alabama","isoCode":"AL","countryCode":"US","latitude":"32.31823140","longitude":"-86.90229800"},{"name":"Alaska","isoCode":"AK","countryCode":"US","latitude":"64.20084130","longitude":"-149.49367330"},{"name":"Arizona","isoCode":"AZ","countryCode":"US","latitude":"34.04892810","longitude":"-111.09373110"},{"name":"Arkansas","isoCode":"AR","countryCode":"US","latitude":"35.20105000","longitude":"-91.83183340"},{"name":"California","isoCode":"CA","countryCode":"US","latitude":"36.77826100","longitude":"-119.41793240"},{"name":"Colorado","isoCode":"CO","countryCode":"US","latitude":"39.55005070","longitude":"-105.78206740"},{"name":"Connecticut","isoCode":"CT","countryCode":"US","latitude":"41.60322070","longitude":"-73.08774900"},{"name":"Delaware","isoCode":"DE","countryCode":"US","latitude":"38.91083250","longitude":"-75.52766990"},{"name":"District of Columbia","isoCode":"DC","countryCode":"US","latitude":"38.90719230","longitude":"-77.03687070"},{"name":"Florida","isoCode":"FL","countryCode":"US","latitude":"27.66482740","longitude":"-81.51575350"},{"name":"Georgia","isoCode":"GA","countryCode":"US","latitude":"32.16562210","longitude":"-82.90007510"},{"name":"Hawaii","isoCode":"HI","countryCode":"US","latitude":"19.89676620","longitude":"-155.58278180"},{"name":"Idaho","isoCode":"ID","countryCode":"US","latitude":"44.06820190","longitude":"-114.74204080"},{"name":"Illinois","isoCode":"IL","countryCode":"US","latitude":"40.63312490","longitude":"-89.39852830"},{"name":"Indiana","isoCode":"IN","countryCode":"US","latitude":"40.26719410","longitude":"-86.13490190"},{"name":"Iowa","isoCode":"IA","countryCode":"US","latitude":"41.87800250","longitude":"-93.09770200"},{"name":"Kansas","isoCode":"KS","countryCode":"US","latitude":"39.01190200","longitude":"-98.48424650"},{"name":"Kentucky","isoCode":"KY","countryCode":"US","latitude":"37.83933320","longitude":"-84.27001790"},{"name":"Louisiana","isoCode":"LA","countryCode":"US","latitude":"30.98429770","longitude":"-91.96233270"},{"name":"Maine","isoCode":"ME","countryCode":"US","latitude":"45.25378300","longitude":"-69.44546890"},{"name":"Maryland","isoCode":"MD","countryCode":"US","latitude":"39.04575490","longitude":"-76.64127120"},{"name":"Massachusetts","isoCode":"MA","countryCode":"US","latitude":"42.40721070","longitude":"-71.38243740"},{"name":"Michigan","isoCode":"MI","countryCode":"US","latitude":"44.31484430","longitude":"-85.60236430"},{"name":"Minnesota","isoCode":"MN","countryCode":"US","latitude":"46.72955300","longitude":"-94.68589980"},{"name":"Mississippi","isoCode":"MS","countryCode":"US","latitude":"32.35466790","longitude":"-89.39852830"},{"name":"Missouri","isoCode":"MO","countryCode":"US","latitude":"37.96425290","longitude":"-91.83183340"},{"name":"Montana","isoCode":"MT","countryCode":"US","latitude":"46.87968220","longitude":"-110.36256580"},{"name":"Nebraska","isoCode":"NE","countryCode":"US","latitude":"41.49253740","longitude":"-99.90181310"},{"name":"Nevada","isoCode":"NV","countryCode":"US","latitude":"38.80260970","longitude":"-116.41938900"},{"name":"New Hampshire","isoCode":"NH","countryCode":"US","latitude":"43.19385160","longitude":"-71.57239530"},{"name":"New Jersey","isoCode":"NJ","countryCode":"US","latitude":"40.05832380","longitude":"-74.40566120"},{"name":"New Mexico","isoCode":"NM","countryCode":"US","latitude":"34.51994020","longitude":"-105.87009010"},{"name":"New York","isoCode":"NY","countryCode":"US","latitude":"40.71277530","longitude":"-74.00597280"},{"name":"North Carolina","isoCode":"NC","countryCode":"US","latitude":"35.75957310","longitude":"-79.01929970"},{"name":"North Dakota","isoCode":"ND","countryCode":"US","latitude":"47.55149260","longitude":"-101.00201190"},{"name":"Ohio","isoCode":"OH","countryCode":"US","latitude":"40.41728710","longitude":"-82.90712300"},{"name":"Oklahoma","isoCode":"OK","countryCode":"US","latitude":"35.46756020","longitude":"-97.51642760"},{"name":"Oregon","isoCode":"OR","countryCode":"US","latitude":"43.80413340","longitude":"-120.55420120"},{"name":"Pennsylvania","isoCode":"PA","countryCode":"US","latitude":"41.20332160","longitude":"-77.19452470"},{"name":"Puerto Rico","isoCode":"PR","countryCode":"US","latitude":"18.22083300","longitude":"-66.59014900"},{"name":"Rhode Island","isoCode":"RI","countryCode":"US","latitude":"41.58009450","longitude":"-71.47742910"},{"name":"South Carolina","isoCode":"SC","countryCode":"US","latitude":"33.83608100","longitude":"-81.16372450"},{"name":"South Dakota","isoCode":"SD","countryCode":"US","latitude":"43.96951480","longitude":"-99.90181310"},{"name":"Tennessee","isoCode":"TN","countryCode":"US","latitude":"35.51749130","longitude":"-86.58044730"},{"name":"Texas","isoCode":"TX","countryCode":"US","latitude":"31.96859880","longitude":"-99.90181310"},{"name":"Utah","isoCode":"UT","countryCode":"US","latitude":"39.32098010","longitude":"-111.09373110"},{"name":"Vermont","isoCode":"VT","countryCode":"US","latitude":"44.55880280","longitude":"-72.57784150"},{"name":"Virginia","isoCode":"VA","countryCode":"US","latitude":"37.43157340","longitude":"-78.65689420"},{"name":"Washington","isoCode":"WA","countryCode":"US","latitude":"47.75107410","longitude":"-120.74013850"},{"name":"West Virginia","isoCode":"WV","countryCode":"US","latitude":"38.59762620","longitude":"-80.45490260"},{"name":"Wisconsin","isoCode":"WI","countryCode":"US","latitude":"43.78443970","longitude":"-88.78786780"},{"name":"Wyoming","isoCode":"WY","countryCode":"US","latitude":"43.07596780","longitude":"-107.29028390"}]
    // console.log(csc)
    res.json({states})
}


exports.getDropdownsByType = async(req, res) => {
  const id = req.query.comp_id
  if(req.params.type === 'employeeslist'){
    res.json(await getEmployeeList(id))
  }else if(req.params.type === 'empType'){
    res.json(await empTypeDD(id))
  }
  else if(req.params.type === 'empTypeList'){
    res.json(await enhancedEmpTypeDD(id))
  }
  else if(req.params.type === 'taskTypeList'){
    res.json(await enhancedtaskTypeDD(id))
  }else if(req.params.type === 'states'){
    res.json(await enhancedStatesDD(id))
  }else if(req.params.type === 'modules'){
    res.json(await enhancedModuleDD(id))
  }else if(req.params.type === 'empLevel'){
    res.json(await empLevelDD(id))
  }else if(req.params.type === 'empStatus'){
    res.json(await empStatusDD(id))
  }
  else if(req.params.type === 'empStatusList'){
    res.json(await enhancedEmpStatusDD(id))
  }
  else if(req.params.type === 'customerslist'){
    res.json(await getCustomerList(id))
  }else if(req.params.type === 'customerType'){
    res.json(await customerTypeDD(id))
  }else if(req.params.type === 'customerTypeList'){
  res.json(await enhancedCustomerTypeDD(id))
  }
  else if(req.params.type === 'customerStatus'){
    res.json(await customerStatusDD(id))
  }else if(req.params.type === 'projectslist'){
res.json(await getProjectList(id))
  }else if(req.params.type === 'taskslist'){
    // res.json(await getTaskList(id))
    res.json(await getTaskListv2(req))
  }else if(req.params.type === 'taskType'){
    res.json(await taskTypeDD(id, req.query.employeeType))
  }else if(req.params.type === 'fullTaskType'){
    res.json(await fullTaskTypeDD(id))
  }else if(req.params.type === 'contactslist'){
    res.json(await getContactList(id))
  }else if(req.params.type === 'designation'){
    res.json(await designationDD(id))
  }else if(req.params.type === 'contactType'){
    res.json(await contactTypeDD(id),)
  }
  else if(req.params.type === 'contactTypeList'){
    res.json(await enhancedContactTypeDD(id))
  }
  else if(req.params.type === 'contactStatus'){
    res.json(await contactStatusDD(id))
  }else if(req.params.type === 'locationslist'){
    res.json(await getLocationList(id))
  }else if(req.params.type === 'locStatus'){
    res.json(await locStatusDD(id))
  }else if(req.params.type === 'locType'){
    res.json(await locTypeDD(id))
  }
  else if(req.params.type === 'locTypeList'){
    res.json(await enhancedlocTypeDD(id))
  }
  else if(req.params.type !== ''){
    res.json(await enhancedTypeDD(id, req.params.type))
  }
  else{
    res.json({type: req.params.type, message: 'Invalid Argument'})
  }
}

exports.getDropdowns = async function (req, res) {
  const id = req.query.comp_id
  const data = {
    employees: {
      list: await getEmployeeList(id),
      empType: await empTypeDD(id),
      empLevel: await empLevelDD(id),
      empStatus: await empStatusDD(id),
      currency: await currencyDD(id),
      frequency: await frequencyDD(id)
    },
    customers: {
      list: await getCustomerList(id),
      customerType: await customerTypeDD(id),
      customerStatus: await customerStatusDD(id)
    },
    projects: {
          	list: await getProjectList(id)
    },
    tasks: {
      list: await getTaskList(id),
      taskType: await taskTypeDD(id)
    },
    contacts: {
      list: await getContactList(id),
      designation: await designationDD(id),
      contactType: await contactTypeDD(id),
      contactStatus: await contactStatusDD(id)
    },
    locations: {
      list: await getLocationList(id),
      states: await statesDD(id),
      locStatus: await locStatusDD(id),
      locType: await locTypeDD(id)
    }
  }
  res.json(data)
}

get_all_yaml_files = async function (dir, fileList = []) {
  const files = fs.readdirSync(dir);

  files.forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      // Recurse into subdirectory
      get_all_yaml_files(fullPath, fileList);
    } else if (file.endsWith('.yaml') || file.endsWith('.yml')) {
      // Collect YAML files
      fileList.push(fullPath);
    }
  });

  console.log(fileList);

  return fileList;
};

read_all_yaml_files = async function (path) {
  try {
    const yaml_files = await get_all_yaml_files(path);
    const json_objects = [];
    let final_condition_map = {};

    yaml_files.forEach(file_path => {
      const file_content = fs.readFileSync(file_path, 'utf8');
      console.log("file read completed", file_path)
      const json_data = yaml.load(file_content);

      if (json_data.resourcePolicy && json_data.resourcePolicy.rules) {
        let actions_map = {

        };

        json_data.resourcePolicy.rules.forEach((rule) => {
          actions_map[rule.actions[0]] = rule.condition ? String(rule.condition.match.expr).replaceAll("request.principal.", "P.") : "";
        })

        final_condition_map[json_data.resourcePolicy.resource] = {
          "actions" : actions_map,
        }

        json_objects.push({
          file_path: file_path,
          json_data: json_data
        });
      }
    });

    return final_condition_map; // Array of { filePath, jsonData }
  } catch (err) {
    console.error('Error reading YAML files:', err);
    return {};
  }
};


async function create_or_update_cerbos_role(file_name, yaml_string, mode) {

  try {
    const repoExists = fs.existsSync(path.join(LOCAL_PATH, '.git'));

    if (!repoExists) {
      console.log("Repo not found, cloning repo!");
      await simpleGit().clone(GIT_URL, LOCAL_PATH);
    } else {
      console.log('Repo found, using local copy!');
    }

    const git = await getConfiguredGit();

    if (env === 'prod') {
      await git.checkout('main');
      await git.pull('origin', 'main');
    } else {
      await git.checkout('dev');
      await git.pull('origin', 'dev');
    }

    const targetDir = path.join(LOCAL_PATH, 'policies/role_policies/');
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const file_path = path.join(targetDir, file_name);
    fs.writeFileSync(file_path, yaml_string, 'utf8');

    const currentBranch = await git.revparse(['--abbrev-ref', 'HEAD']);
    console.log(`Currently on branch: ${currentBranch}`);

    await git.add(`policies/role_policies/${file_name}`);
    await git.commit(`Role ${mode}: policies/role_policies/${file_name}`);
    await git.push('origin', env === 'prod' ? 'main' : 'dev');

    console.log('Pushed changes to Git!');
    return {
      success: true,
      env,
      currentBranch
    }
  } catch (err) {
    console.log(err);
    return {
      success: false,
      error: {
        message: err.message,
        stack: err.stack,
        name: err.name,
        code: err.code || null, 
      }
    }
  }
}

async function delete_cerbos_role(file_name) {

  try {
    const repoExists = fs.existsSync(path.join(LOCAL_PATH, '.git'));

    if (!repoExists) {
      console.log("Repo not found, cloning repo!");
      await simpleGit().clone(GIT_URL, LOCAL_PATH);
    } else {
      console.log('Repo found, using local copy!');
    }

    const git = await getConfiguredGit();

    if (env === 'prod') {
      await git.checkout('main');
      await git.pull('origin', 'main');
    } else {
      await git.checkout('dev');
      await git.pull('origin', 'dev');
    }

    let file_path = path.join(__dirname, `repo-clone/policies/role_policies/${file_name}`);
    console.log(file_path, file_name, `repo-clone/policies/role_policies/${file_name}`);
    if (fs.existsSync(file_path)) {
      fs.unlinkSync(file_path);
      await git.rm(`policies/role_policies/${file_name}`);
      await git.commit(`Delete policies/role_policies/${file_name}`);
      await git.push();

    } else {
      console.log("Policy file doesn't exist!");
    }
    return {
      success: true,
    }
  } catch (err) {
    console.log(err);
    return {
      success: false,
      error: {
        message: err.message,
        stack: err.stack,
        name: err.name,
        code: err.code || null, 
      }
    }
  }

}

get_condition_json = async function () {
  const repoExists = fs.existsSync(path.join(LOCAL_PATH, '.git'));

  if (!repoExists) {
    console.log("Repo not found, cloning repo!");
    await simpleGit().clone(GIT_URL, LOCAL_PATH);
  } else {
    console.log('Repo found, using local copy!');
  }

  const git = await getConfiguredGit();
  if (env === 'prod') {
    await git.checkout('main');
    await git.pull('origin', 'main');
  } else {
    await git.checkout('dev');
    await git.pull('origin', 'dev');
  }
  const final_condition_map = await read_all_yaml_files(LOCAL_PATH);

  return final_condition_map;
}

async function get_file_name_yaml(req) {
  let role_title = `${String(req.body.entityValue).replaceAll(" ","").toLowerCase()}_${req.body.comp_id}`;
  let permissions = req.body.permissions;
  let parent_role = String(req.body.parent_role).toLowerCase();
  let policy = {
    apiVersion: "api.cerbos.dev/v1",
    rolePolicy: {
      role: role_title,
      parentRoles: [parent_role],
      rules: []
    }
  }

  let conditions = await get_condition_json();

  Object.entries(permissions).forEach(([key, val]) => {
    let key_split = key.split("_");
    let resource = key_split[1];
    let action = key_split[2];

    let condition = conditions[resource] ? (conditions[resource]["actions"] ? (conditions[resource]["actions"][action] ? conditions[resource]["actions"][action] : ""): "") : "";
    let rule = {
      resource: resource,
      allowActions: [action],
    }
    if (condition) {
      rule = {
        ...rule,
        condition: {
          match: {
            expr: condition,
          }
        }
      }
    }
    if (val) {
      policy["rolePolicy"]["rules"].push(rule);
    }
  })

  let file_name = `${role_title}.yaml`;
  const yaml_string = yaml.dump(policy, { noRefs: true, indent: 2 });

  return {
    file_name,
    yaml_string
  }
}

addNewEmpType = async function (req, res) {

  let {file_name, yaml_string} = await get_file_name_yaml(req);

  let status = await create_or_update_cerbos_role(file_name, yaml_string, "added"); 

  if (status.success) {
    const query = `insert into dropdowns (EntityName,EntityValue,CompanyID,is_Active,employeeType) values ('${req.body.entityName}','${req.body.entityValue}',${req.body.comp_id}, ${req.body.is_Active || 3}, '${req.body.parent_role}'); SELECT SCOPE_IDENTITY()`
    const dd_Id = await DBinsertSendID(query)
    if (!dd_Id) {
      return res.json({ code: 500, message: 'Dropdown Query to add to DB Failed', status });
    } else {
      return res.json({ code: 200, dd_data: { id: dd_Id, name: req.body.entityName, value: req.body.entityValue }, message: 'Dropdown query to add to DB Success', status });
    }
  } else {
    return res.json({ code: 500, message: 'Git process failed', status });
  }

}

deleteEmpType = async function (req, res) {


  let file_name = `${String(req.body.entityValue).replaceAll(" ","").toLowerCase()}_${req.body.comp_id}.yaml`;
  let id = req.body.id;
  
  let status = await delete_cerbos_role(file_name); 

  if (status.success) {
    const query = `delete from dropdowns where ddID = ${id}`
    // console.log(query)
    const dd_update_res = await DBUpdate(query)
    if (dd_update_res === 0) {
      return res.json({ code: 500, message: 'Dropdown Update Query Failed', status })
    }
    res.json({ code: 200, dd_data: { name: req.body.entityName, value: req.body.entityValue }, message: 'Dropdown Delete Success', status })
  } else {
    return res.json({ code: 500, message: 'Git process failed', status });
  }

}

updateEmpType = async function (req, res) {
  let responseStatus = {};
  if (req.body.updatePermissions) {
    let {file_name, yaml_string} = await get_file_name_yaml(req);

    let status = await create_or_update_cerbos_role(file_name, yaml_string, "updated"); 

    if (status.success) {
      responseStatus = { dd_data: { name: req.body.entityName, value: req.body.entityValue }, message: 'Git policy updated', status };
    } else {
      responseStatus = { message: 'Git update failed', status };
    }
  }
  console.log(responseStatus);
  let query = `update dropdowns SET is_Active='${req.body.is_Active}' where ddID = ${req.body.ddId}`;
  const dd_update_res = await DBUpdate(query)
  if (dd_update_res === 0) {
    return res.json({ code: 500, message: 'Dropdown Update Failed', status: {success: false}, responseStatus });
  } else {
    return res.json({ code: 200, message: 'Dropdown update success', status: {success: req.body.updatePermissions ? responseStatus.status.success : true}, responseStatus});
  }
}

exports.addDropdowns = async function (req, res) {

  if (req.body.entityName === 'empType') {
    return addNewEmpType(req, res);
  }

  const query = `insert into dropdowns (EntityName,EntityValue,CompanyID,is_Active) values ('${req.body.entityName}','${req.body.entityValue}',${req.query.comp_id}, ${req.query.is_Active || 3}); SELECT SCOPE_IDENTITY()`
  // console.log(query)
  const dd_Id = await DBinsertSendID(query)
  if (!dd_Id) {
    res.json({ code: 500, message: 'Dropdown Add to DB Failed' })
  } else {
    res.json({ code: 200, dd_data: { id: dd_Id, name: req.body.entityName, value: req.body.entityValue }, message: 'Dropdown Add to DB Success' })
  }
}

exports.updateDropdown = async function (req, res) {
  if (req.body.entityName === "empType") {
    return updateEmpType(req, res);
  }
  let query = ''
  if(req.body.entityValue){
    query = `update dropdowns SET EntityValue='${req.body.entityValue}' where ddID = ${req.body.ddId}`
  }else{
    query = `update dropdowns SET is_Active=${req.body.is_Active} where ddID = ${req.body.ddId}`
  }
   // console.log(query)
  const dd_update_res = await DBUpdate(query)
  if (dd_update_res === 0) {
    res.json({ code: 500, message: 'Dropdown Update Failed' })
  }
  let com_id = req.body.company_id, emp_id = req.body.emp_id;
  if (com_id && emp_id && req.body.ddId && req.body.entityValue) {
    analytics.track({
      userId: String(emp_id),
      event: 'Config settings changed',
      context: {
        groupId: com_id,
      },
      properties: {
        id: req.body.ddId, 
        value: req.body.entityValue
      }
    })
    console.log("logged to segment successfully")
  }
  res.json({ code: 200, dd_data: { id: req.body.ddId, value: req.body.entityValue }, message: 'Dropdown Update Success' })
}

exports.enhancedDeleteDD = async function (req, res) {
  const query = `update dropdowns SET is_Active=2 where ddID = ${req.body.ddId}`
  // console.log(query)
  const dd_update_res = await DBUpdate(query)
  if (dd_update_res === 0) {
    res.json({ code: 500, message: 'Dropdown Update Failed' })
  }
  res.json({ code: 200, dd_data: { dd_id: req.body.ddId}, message: 'Dropdown Delete Success' })
}

exports.deleteDropdown = async function (req, res) {
  if (req.body.entityName === "empType") {
    return deleteEmpType(req, res);
  }
  const query = `delete from dropdowns where EntityValue='${req.body.entityValue}' and EntityName = ${req.body.entityName}`
  // console.log(query)
  const dd_update_res = await DBUpdate(query)
  if (dd_update_res === 0) {
    res.json({ code: 500, message: 'Dropdown Update Failed' })
  }
  res.json({ code: 200, dd_data: { name: req.body.entityName, value: req.body.entityValue }, message: 'Dropdown Delete Success' })
}

exports.bulkInsert = async function (req, res) {
  if (req.query.com_id) {
    var query = `EXEC insertDropDowns @company_id = ${req.query.com_id}`
  } else {
    res.json({ code: 500, message: 'Dropdown Bulk Add to DB Failed' })
  }

  // console.log(query)
  const dd_id = await DBUpdate(query)
  if (dd_id === 0) {
    res.json({ code: 500, message: 'Dropdown Bulk Add to DB Failed' })
  } else {
    res.json({ code: 200, message: 'Dropdown  Bulk Add to DB Success' })
  }
}

exports.updateSettingsDropdown = async function (req, res) {
  const query = `update dropdowns SET EntityValue='${req.body.entityValue}' where ddID = ${req.body.dd_Id}`
  // console.log(query)
  const dd_update_res = await DBUpdate(query)
  if (dd_update_res === 0) {
    res.json({ code: 500, message: 'Dropdown Update Failed' })
  }
  res.json({ code: 200, dd_data: { id: req.body.dd_Id, value: req.body.entityValue }, message: 'Dropdown Update Success' })
}

exports.insertSettingsDropdown = async function (req, res) {
  let query = 'insert into dropdowns (EntityName,EntityValue,CompanyID) values '
  const updateStatementsList = []
  var updateQuery = `update dropdowns SET CompanyID = ${-2004} `

  console.log(req.body.data.length)
  console.log(req.body.data)
  if (req.body.data.length > 0) {
    var isInsertPresent = false
    for (var dropData = 0; dropData < req.body.data.length; dropData++) {
      if (req.body.data[dropData].isChecked !== undefined && req.body.data[dropData].isChecked === true && req.body.data[dropData].isDefault !== undefined && req.body.data[dropData].isDefault === true) {
        query = query + `('${req.body.data[dropData].entitytype}','${req.body.data[dropData].value}',${2004}),`
        isInsertPresent = true
        console.log(req.body.data.length)
        console.log(dropData)
      } else if (req.body.data[dropData].isChecked !== undefined && req.body.data[dropData].isChecked === false && req.body.data[dropData].isDefault !== undefined && req.body.data[dropData].isDefault === false) {
        var updateQuery = `update dropdowns SET is_Active = ${1}  where EntityName = '${req.body.data[dropData].entitytype}' AND  EntityValue = '${req.body.data[dropData].value}' And CompanyId = ${2004};`
        updateStatementsList.push(updateQuery)
      }
    }
    query = query.slice(0, -1) + ';'
  }
  let dd_Id
  try {
    if (isInsertPresent) {
				 await DBinsertSendID(query)
    }
  } catch (_) {
  }

  let dd_update_res

  if (updateStatementsList.length > 0) {
	          for (var dropData = 0; dropData < updateStatementsList.length; dropData++) {
      try {
        dd_update_res = await DBUpdate(updateStatementsList[dropData])
			    } catch (_) {
			    }
    }
  }

  console.log(query)
  console.log(updateStatementsList)

  // if(!dd_Id){
  // 	res.json({code: 500, message: "Dropdown Add to DB Failed"});
  // }else if(dd_update_res === 0){
  // 	res.json({code: 500, message: "Problem Occured While Updating Dropdown"});
  // }else{
  res.json({ code: 200, messageInsert: 'Dropdown Add to DB Sucessfully', messageUpdate: 'Dropdown Update Sucessfully' })
  // }
}
