const db = require('../models/indexSQL.js')
const path = require('path')
const { DBinsertSendID, DBUpdate, DBinsertSendResponse, DBSendResponse } = require('../queries/commonQueries')
const { CONTAINER_NAME, BLOB_KEY, LOG_LEVEL } = require('../config')
const { BlobServiceClient, StorageSharedKeyCredential } = require('@azure/storage-blob')
var {SEGMENT_API_KEY} = require("../config");
const { Analytics } = require('@segment/analytics-node')
const analytics = new Analytics({ writeKey: SEGMENT_API_KEY })

// acount information
const account = 'fieldworkblob'
const accountKey = BLOB_KEY

// storage key and service client generation
const sharedKeyCredential = new StorageSharedKeyCredential(account, accountKey)
const blobServiceClient = new BlobServiceClient(
  `https://${account}.blob.core.windows.net`,
  sharedKeyCredential
)

// container information
const containerName = CONTAINER_NAME
const urlPrefix = `https://fieldworkblob.blob.core.windows.net/${containerName}/`

exports.getArtifact = async function (req, res) {
  await getArtifacts(req, res)
}

exports.getJsonArtifact = async function (req, res) {
  await getJsonArtifact(req, res)
}

exports.addArtifact = function (req, res) {
  addArtifact(req, res).catch((err) => {
    req.log.error(err, 'addArtifact failed')
    if (!res.headersSent) res.status(500).json({ message: 'Failed to upload artifact' })
  })
}

exports.addJsonArtifact = function (req, res) {
  addJsonArtifact(req, res)
}

exports.deleteJsonArtifact = function (req, res) {
  deleteJsonArtifact(req, res)
}

async function addArtifact (req, res) {
  // multer leaves req.file undefined when the multipart body has no 'snapshot' part
  if (!req.file) {
    return res.status(400).json({ message: "No file received (expected multipart field 'snapshot')" })
  }
  const IDQuery = 'SELECT MAX(id) FROM artifacts;'
  const fileType = path.parse(req.file.originalname).ext.replace('.', '')
  let id = await DBinsertSendResponse(IDQuery)
  id = id[0]['']
  id += 1
  id += path.extname(req.file.originalname)

  art_url = urlPrefix + id
  req.log.debug(art_url)

  const containerClient = blobServiceClient.getContainerClient(containerName)
  const blockBlobClient = containerClient.getBlockBlobClient(id)
  if(LOG_LEVEL === 'trace') {
    req.log.debug('\nUploading to Azure storage as blob:\n\t', id)
    req.log.debug(`\n req.file.buffer : '${req.file.buffer}'`)
    req.log.debug(`\n req.file.buffer.length : '${req.file.buffer.length}'`)
  }

  const	options = { blobContentType: 'application/' + fileType }
  const uploadBlobResponse = await blockBlobClient.upload(req.file.buffer, req.file.buffer.length, { blobHTTPHeaders: options })
  if(LOG_LEVEL === 'trace') {
    req.log.debug('Blob was uploaded successfully. requestId: ', uploadBlobResponse.requestId)
    req.log.debug(uploadBlobResponse)
    req.log.debug(req.body)
    req.log.debug("END ARTIFACT BLOB DEBUG!!!")
  }

  if (uploadBlobResponse.requestId) {
    const query = 'insert into artifacts(file_name,url,project_id,task_id,employee_id,customer_id,directory_id,show,submitted) values (' +
		  "'" + req.body.file_name.replaceAll("'", "''") + "'," +
		  "'" + art_url + "'," +
		  '' + (!!req.body.proj_id ? req.body.proj_id : 'NULL') + ',' +
		  '' + (!!req.body.task_id ? req.body.task_id : 'NULL') + ',' +
		  '' + (!!req.body.emp_id ? req.body.emp_id : 'NULL') + ',' +
      '' + (!!req.body.cus_id ? req.body.cus_id : 'NULL') + ',' +
      '' + (!!req.body.directory_id ? req.body.directory_id : 'NULL') + ',' +
		  "'" + true + "'," +
		  'CURRENT_TIMESTAMP); SELECT SCOPE_IDENTITY();'
    req.log.debug(query)

    // DBinsert(res, query);
    const addedArt = await DBinsertSendID(query)
    req.log.debug(addedArt)
    if (addedArt) {
      res.json({ message: 'Add Artifact Success', code: 200, id: addedArt, url: art_url })
    } else {
      res.json({ message: 'Add Artifact Failed', code: 500 })
    }
  } else {
    res.json({ message: 'Add Artifact Failed', code: 500 })
  }
  // DBinsert(res, query);
  // res.send('Added or not')
}

async function getJsonArtifact(req, res) {
    if(req.query.task_id === undefined || req.query.task_id === null){
        res.json();
        return;
    }
    let artifacts

  var query = 'select * from artifacts where ' +
  'project_id is null and ' +
  "file_name='JSON' and task_id=" + 
  req.query.task_id + ' and ' +
  "show='true';"
  artifacts = await DBSendResponse(query);
  req.log.debug(artifacts.length);
  if(artifacts.length === 0) {
    res.json();
    return;
  }
  artifact = artifacts[0]

  const containerClient = blobServiceClient.getContainerClient(containerName)
  const blockBlobClient = containerClient.getBlockBlobClient(artifact.id + '.json')

  const downloadBlockBlobResponse = await blockBlobClient.download(0);
  const downloaded = await streamToText(downloadBlockBlobResponse.readableStreamBody)

  res.json({ json: JSON.parse(downloaded), id: artifact.id})

  async function streamToText(readable) {
    readable.setEncoding('utf8');
    let data = '';
    for await (const chunk of readable) {
      data += chunk;
    }
    return data;
  }
}

async function addJsonArtifact(req, res) {

  const IDQuery = 'SELECT MAX(id) FROM artifacts;'

  let id = await DBinsertSendResponse(IDQuery)
  id = id[0]['']
  id += 1
  id += ".json"
  
  art_url = urlPrefix + id
  req.log.debug(art_url);

  const containerClient = blobServiceClient.getContainerClient(containerName)
  const blockBlobClient = containerClient.getBlockBlobClient(id)

  const	options = { blobContentType: 'application/json' };
  const uploadBlobResponse = await blockBlobClient.upload(req.body.json, Buffer.byteLength(req.body.json) , { blobHTTPHeaders: options })

  if (uploadBlobResponse.requestId) {
    const file_name = "JSON";
    const query = 'insert into artifacts(file_name,url,task_id,employee_id,show,submitted) values (' +
		"'" + file_name + "'," +
		"'" + art_url + "'," +
		'' + req.body.task_id + ',' +
		'' + req.body.emp_id + ',' +
		"'" + true + "'," +
		'CURRENT_TIMESTAMP); SELECT SCOPE_IDENTITY();'
    req.log.debug(query)

    // DBinsert(res, query);
    const addedArt = await DBinsertSendID(query)
    req.log.debug(addedArt)
    if (addedArt) {
      res.json({ message: 'Add Artifact Success', code: 200, id: addedArt, url: art_url })
    } else {
      res.json({ message: 'Add Artifact Failed', code: 500 })
    }
  } else {
    res.json({ message: 'Add Artifact Failed', code: 500 })
  }

}

async function deleteJsonArtifact(req, res) {
  const query = `UPDATE artifacts SET show='false' WHERE id=${req.query.id}`
  const Art_update_res = await DBUpdate(query)
  if (Art_update_res === 0) {
    res.json({ code: 500, message: 'Artifact Delete Failed' })
  }
  res.json({ code: 200, message: 'Artifact Delete Success' })
}


async function getArtifacts (req, res) {
  let artifacts
  if (req.query.com_id) {
    var query = `select * from artifacts
		where project_id IN 
		(select pro_id from project where pro_com_id = ${req.query.com_id});`
    artifacts = await DBSendResponse(query)
  } else if (req.query.comp_id) {
    artifacts = await getArts(req, res)
  } else if (req.query.cus_id) {
    var query = `select a.*, p.pro_title, t.tas_title
    from artifacts a
    left join project p on p.pro_id = a.project_id
    left join task t on t.tas_id = a.task_id
    where a.customer_id = ${req.query.cus_id};`
    artifacts = await DBSendResponse(query)
  } else if (req.query.tas_id) {
    var query = `select * from artifacts where task_id = ${req.query.tas_id};`
    artifacts = await DBSendResponse(query)
  } else {
    var query = `select * from artifacts
		where project_id=${req.query.id}`
    artifacts = await DBSendResponse(query)
  }
  res.json(artifacts)
}

async function getArts (req, res) {
  const query = `select id,url,file_name,show,submitted,
	(select emp_id,emp_first_name,emp_last_name,emp_type,emp_is_active from employee where emp_id = employee_id for JSON PATH) as employeeInfo,
	(select pro_id,pro_title,pro_customer_id,cus_name,cus_address,cus_type,cus_is_active from project,customer where pro_customer_id=cus_id and pro_id = project_id for JSON PATH) as projectInfo, 
	(select tas_id,tas_title,tas_is_active from task where tas_id = task_id for JSON PATH) as taskInfo 
	from artifacts
	where project_id IN 
	(select pro_id from project where pro_com_id = ${req.query.comp_id});`
  let artList = await DBSendResponse(query)
  artList = artList.map((art) => {
    art.projectInfo = JSON.parse(art.projectInfo)[0]
    art.employeeInfo = JSON.parse(art.employeeInfo)[0]
    art.taskInfo = JSON.parse(art.taskInfo)[0]
    return art
  })
  if (req.query.proj_id) {
    artList = artList.filter((art) => art.projectInfo.pro_id === +req.query.proj_id && !!art.show)
  } else if (req.query.task_id) {
    artList = artList.filter((art) => art.taskInfo.tas_id === +req.query.task_id && !!art.show)
  } else if (req.query.cust_id) {
    artList = artList.filter((art) => art.projectInfo.pro_customer_id === +req.query.cust_id && !!art.show)
  } else if (req.query.emp_id) {
    artList = artList.filter((art) => art.employeeInfo.emp_id === +req.query.emp_id && !!art.show)
  } else if (req.query.art_id) {
    artList = artList.filter((art) => art.id === +req.query.art_id && !!art.show)
  } else {
    artList = artList
  }

  if (!!req.query.lastN && artList.length > +req.query.lastN) {
    artList = artList.slice(Math.max(artList.length - +req.query.lastN, 0))
  }
  return artList
}

exports.delArtifacts = async function (req, res) {
  const query = `UPDATE artifacts SET show='false', directory_id=NULL WHERE id=${req.body.id}`

  if (req.body.emp_id && req.body.comp_id && req.body.id) {
    analytics.track({
      userId: String(req.body.emp_id),
      event: 'File deleted',
      context: {
        groupId: req.body.comp_id,
      },
      properties: {
        fileId: req.body.id
      }
    })
  }
  const Art_update_res = await DBUpdate(query)
  if (Art_update_res === 0) {
    res.json({ code: 500, message: 'Artifact Update Failed' })
  }
  res.json({ code: 200, message: 'Artifact Delete Success' })
}

exports.updateDirectory = async function (req, res) {
  const query = `UPDATE artifacts SET directory_id=${req.body.directory_id} WHERE id=${req.params.id}`
  req.log.debug(req.body.emp_id,req.body.comp_id,req.body.directory_id,req.params.id)
  if (req.body.emp_id && req.body.comp_id && req.body.directory_id && req.params.id) {
    analytics.track({
      userId: String(req.body.emp_id),
      event: 'File moved',
      context: {
        groupId: req.body.comp_id,
      },
      properties: {
        movedTo: req.body.directory_id,
        id: req.params.id
      }
    })
    req.log.debug("logged to segment successfully")
  }

  const artUpdate = await DBUpdate(query)
  if (artUpdate === 0) {
    res.json({ code: 500, message: 'Artifact Update Failed' })
  }
  res.json({ code: 200, message: 'Artifact Update Success' })
}