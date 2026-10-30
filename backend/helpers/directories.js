const db = require('../models/indexSQL.js')
const { DBinsertSendID, DBinsert, DBUpdate, DBSendResponse, DBinsertSendResponse } = require('../queries/commonQueries')
const { getCustomersAssociatedAPI } = require('../helpers/customers')
const e = require('express')
var {SEGMENT_API_KEY} = require("../config");
const { Analytics } = require('@segment/analytics-node')
const analytics = new Analytics({ writeKey: SEGMENT_API_KEY })

const getProgramIdFromReq = (req) => {
  const parsed = parseInt(req.query.program_id, 10);
  return Number.isInteger(parsed) ? parsed : null;
};

const isPublicFolderPath = (filePath) => {
  const normalized = String(filePath || '');
  return normalized === 'root/Public' || normalized.startsWith('root/Public/');
};

// Customers with at least one project under the given program.
const getProgramCustomerIds = async (programId) => {
  const rows = await DBSendResponse(`SELECT DISTINCT pro_customer_id AS cus_id FROM project WHERE pro_program_id = ${programId} AND pro_customer_id IS NOT NULL`);
  return new Set(rows.map((row) => Number(row.cus_id)));
};

// Projects directly under the given program.
const getProgramProjectIds = async (programId) => {
  const rows = await DBSendResponse(`SELECT pro_id FROM project WHERE pro_program_id = ${programId}`);
  return new Set(rows.map((row) => Number(row.pro_id)));
};

exports.createDirectory = async function (req, res) {
  const transaction = new db.Transaction()

  transaction.begin(err => {
    const request = new db.Request(transaction)
    request.query(`INSERT INTO directories (name, parent_id, date_added, extID, created_by) OUTPUT INSERTED.* VALUES ('${req.body.name}', ${req.body.parent_id}, GETDATE(), ${req.body.extID}, ${req.body.created_by});`, (err, result) => {
      if(err) {
        console.log(err)
        transaction.rollback(err => {
          res.json({ code: 500, message: 'Directory not created' })
        })
      } else {
        const directory = result.recordset[0];
        let depth = 0;
        request.query(`SELECT depth FROM directory_tree WHERE descendant_id=${req.body.parent_id}`, (err, result) => { // get the depth of the parent directory so we can add the new directory at the correct depth
          if(err) {
            console.log(err)
            transaction.rollback(err => {
              res.json({ code: 500, message: 'Directory not created' })
            })
          } else {
            if(result.recordset.length > 0) {
              depth = result.recordset[0]['depth'] + 1;
            }
            const ancestor_id = directory.parent_id === null ? directory.directory_id : directory.parent_id;
            const descendant_id = directory.directory_id;
            request.query(`INSERT INTO directory_tree (ancestor_id, descendant_id, depth, date_added) VALUES (${ancestor_id}, ${descendant_id}, ${depth}, GETDATE())`, (err, result) => {
              if(err) {
                console.log(err)
                transaction.rollback(err => {
                  res.json({ code: 500, message: 'Directory not created' })
                })
              } else {
                transaction.commit(err => {
                  if (req.body.created_by && req.body.extID && req.body.name && req.body.parent_id) {
                    analytics.track({
                      userId: String(req.body.created_by),
                      event: 'Directory created',
                      context: {
                        groupId: req.body.extID,
                      },
                      properties: {
                        name: req.body.name,
                        parentId: req.body.parent_id
                      }
                    })
                  }
                  res.json({ code: 200, message: 'Directory created', id: directory.directory_id })
                })
              }
            })
          }
        })
      }
    })
  })
}

exports.getDirectory = async function (req, res) {
  const id = req.params.id
  const query = `SELECT * from directories WHERE directory_id=${id}`
  const directory = await DBSendResponse(query)

  res.json(directory)
}

exports.updateDirectory = async function (req, res) {
  const transaction = new db.Transaction()
  const id = req.params.id

  transaction.begin(err => {
    const request = new db.Request(transaction)

    request.query('SELECT * FROM directories WHERE directory_id=' + id, (err, result) => {
      if(err) {
        console.log(err)
        transaction.rollback(err => {
          res.json({ code: 500, message: 'Directory not updated' })
        })
      } else {
        const initDirectory = result.recordset[0];
        request.query(`UPDATE directories SET name='${req.body.name}', parent_id=${req.body.parent_id}, extID=${req.body.extID} OUTPUT INSERTED.* WHERE directory_id=${id}`, (err, result) => {
          if(err) {
            console.log(err)
            transaction.rollback(err => {
              res.json({ code: 500, message: 'Directory not updated' })
            })
          } else {
            const updatedDirectory = result.recordset[0];
            if(updatedDirectory.parent_id !== initDirectory.parent_id) {
              request.query(`SELECT depth FROM directory_tree WHERE descendant_id=${updatedDirectory.parent_id}`, (err, result) => { // get the depth of the parent directory so we can add the new directory at the correct depth
                if(err) {
                  console.log(err)
                  transaction.rollback(err => {
                    res.json({ code: 500, message: 'Directory not updated' })
                  })
                } else {
                  let depth = 0;
                  if(result.recordset.length > 0) {
                    depth = result.recordset[0]['depth'] + 1;
                  }
                  const ancestor_id = updatedDirectory.parent_id === null ? updatedDirectory.directory_id : updatedDirectory.parent_id;
                  const descendant_id = updatedDirectory.directory_id;
                  request.query(`UPDATE directory_tree SET ancestor_id=${ancestor_id}, depth=${depth} WHERE descendant_id=${descendant_id}`, (err, result) => {
                    if(err) {
                      console.log(err)
                      transaction.rollback(err => {
                        res.json({ code: 500, message: 'Directory not updated' })
                      })
                    } else {
                      if (req.body.emp_id && req.body.comp_id && req.body.directory_id && req.params.id) {
                        analytics.track({
                          userId: String(req.body.emp_id),
                          event: 'Directory moved',
                          context: {
                            groupId: req.body.comp_id,
                          },
                          properties: {
                            movedTo: req.body.directory_id,
                            id: req.params.id
                          }
                        })
                        console.log("logged to segment successfully")
                      }
                      transaction.commit(err => {
                        res.json({ code: 200, message: 'Directory updated' })
                      })
                    }
                  })
                }
              })
            } else { // the directory is not being moved to a different parent directory so we don't need to change the directory_tree table
              if (req.body.emp_id && req.body.comp_id && req.body.directory_id && req.params.id) {
                analytics.track({
                  userId: String(req.body.emp_id),
                  event: 'Directory moved',
                  context: {
                    groupId: req.body.comp_id,
                  },
                  properties: {
                    movedTo: req.body.directory_id,
                    id: req.params.id
                  }
                })
                console.log("logged to segment successfully")
              }
              transaction.commit(err => {
                res.json({ code: 200, message: 'Directory updated' })
              })
            }
          }
        })
      }
    })
  })
}

exports.deleteDirectory = async function (req, res) {
  const transaction = new db.Transaction()
  const id = req.params.id

  transaction.begin(err => {
    const request = new db.Request(transaction)
    request.query(`DELETE FROM directory_tree WHERE descendant_id=${id}`, (err, result) => {
      if(err) {
        console.log(err)
        transaction.rollback(err => {
          res.json({ code: 500, message: 'Directory not deleted' })
        })
      } else {
        request.query(`UPDATE artifacts SET directory_id=NULL WHERE directory_id=${id}`, (err, result) => {
          if(err) {
            console.log(err)
            transaction.rollback(err => {
              res.json({ code: 500, message: 'Directory not deleted' })
            })
          } else {
            request.query(`DELETE FROM directories WHERE directory_id=${id}`, (err, result) => {
              if(err) {
                console.log(err)
                transaction.rollback(err => {
                  res.json({ code: 500, message: 'Directory not deleted' })
                })
              } else {
                transaction.commit(err => {
                  if (req.body.emp_id && req.body.comp_id && id) {
                    analytics.track({
                      userId: String(req.body.emp_id),
                      event: 'Directory deleted',
                      context: {
                        groupId: req.body.comp_id,
                      },
                      properties: {
                        directoryId: id
                      }
                    })
                  }
                  res.json({ code: 200, message: 'Directory deleted' })
                })
              }
            })
          }
        })
      }
    })
  })
}

// get all files with their full path
exports.getAllFiles = async function (req, res) {
  let query = `WITH CTE AS (
    SELECT directory_id, name, 0 AS depth, CAST(name AS VARCHAR(255)) AS file_path
    FROM directories d
    WHERE parent_id IS NULL and extID=${req.params.extID}
    UNION ALL 
    SELECT d2.directory_id, d2.name, depth + 1, CAST(file_path + '/' + CAST(d2.name AS VARCHAR(255)) AS VARCHAR(255)) AS file_path
    FROM directories d2
    INNER JOIN CTE subdirectory ON subdirectory.directory_id=d2.parent_id
  )
  SELECT file_path, file_name, d.name AS directory_name, d.directory_id, e.emp_first_name + ' ' + e.emp_last_name AS emp_name, c.cus_name,
         a.submitted AS upload_date, a.id as file_id, a.employee_id as uploaded_by, a.customer_id, a.project_id, d.locked, d.created_by, d.extID, d.parent_id, a.url as file_url, d.date_added as directory_date_added
    FROM CTE
    LEFT JOIN directories d ON d.directory_id=CTE.directory_id
    LEFT JOIN artifacts a ON a.directory_id=CTE.directory_id AND a.show='true'
    LEFT JOIN employee e ON e.emp_id=a.employee_id
    LEFT JOIN customer c ON c.cus_id=a.customer_id
    ORDER BY file_path`

  let files = await DBSendResponse(query)

  const programId = getProgramIdFromReq(req);
  if (programId) {
    const isAdmin = req.query.is_admin === 'true' || req.query.is_admin === true;
    const [allowedCustomerIds, allowedProjectIds] = await Promise.all([
      getProgramCustomerIds(programId),
      getProgramProjectIds(programId),
    ]);

    files = files.filter((file) => {
      // Folders (no file attached) stay visible; only leaf files are program-filtered.
      if (!file.file_id) {
        return true;
      }
      // Non-admins always see everything under Public, regardless of program.
      if (!isAdmin && isPublicFolderPath(file.file_path)) {
        return true;
      }
      // Files with no customer/project association aren't affected by program filtering.
      if (!file.customer_id && !file.project_id) {
        return true;
      }
      return (file.customer_id && allowedCustomerIds.has(Number(file.customer_id)))
        || (file.project_id && allowedProjectIds.has(Number(file.project_id)));
    });
  }

  res.json(files)
}

exports.initiateDirectories = async function (req, res) {
  // create root directory for company if it doesn't exist
  // create three subdirectories for the root if they don't exist (secure, public, and artifacts)
  // create the directory tree for the three subdirectories
  // create the directory tree for the root directory

  const transaction = new db.Transaction()
  const company_id = req.params.company_id

  transaction.begin(err => {
    const request = new db.Request(transaction)
    request.query(`SELECT * FROM directories WHERE name='root' AND parent_id IS NULL AND extID=${company_id}`, (err, result) => {
      if(err) {
        console.log(err)
        transaction.rollback(err => {
          res.json({ code: 400, message: 'Directories already exist' })
        })
      } else {
        if(result.recordset.length === 0) {
          request.query(`INSERT INTO directories (name, parent_id, date_added, extID) OUTPUT INSERTED.* VALUES ('root', NULL, GETDATE(), ${company_id}); SELECT SCOPE_IDENTITY();`, (err, result) => {
            if(err) {
              console.log(err)
              transaction.rollback(err => {
                res.json({ code: 500, message: 'Directories not created' })
              })
            } else {
              const root = result.recordset[0];
              request.query(`INSERT INTO directory_tree (ancestor_id, descendant_id, depth, date_added) VALUES (${root.directory_id}, ${root.directory_id}, 0, GETDATE())`, (err, result) => {
                if(err) {
                  console.log(err)
                  transaction.rollback(err => {
                    res.json({ code: 500, message: 'Directories not created' })
                  })
                } else {
                  request.query(`INSERT INTO directories (name, parent_id, date_added, extID, locked) OUTPUT INSERTED.* VALUES ('Secure', ${root.directory_id}, GETDATE(), ${company_id}, 0), ('Public', ${root.directory_id}, GETDATE(), ${company_id}, 0), ('Artifacts', ${root.directory_id}, GETDATE(), ${company_id}, 1); SELECT SCOPE_IDENTITY();`, (err, result) => {
                    if(err) {
                      console.log(err)
                      transaction.rollback(err => {
                        res.json({ code: 500, message: 'Directories not created' })
                      })
                    } else {
                      const directories = result.recordset;
                      let query = `INSERT INTO directory_tree (ancestor_id, descendant_id, depth, date_added) VALUES`
                      directories.forEach((directory, index) => {
                        query += `(${root.directory_id}, ${directory.directory_id}, 1, GETDATE())`
                        if (index < directories.length - 1) {
                          query += ','
                        }
                      })
                      request.query(query, (err, result) => {
                        if(err) {
                          console.log(err)
                          transaction.rollback(err => {
                            res.json({ code: 500, message: 'Directories not created' })
                          })
                        } else {
                          transaction.commit(err => {
                            res.json({ code: 200, message: 'Directories created' })
                          })
                        }
                      })
                    }
                  })
                }
              })
            }
          })
        } else {
          transaction.rollback(err => {
            res.json({ code: 400, message: 'Directories already exist' })
          })
        }
      }
    })
  })
}
                    
exports.getVirtualDirectories = async function (req, res) {
  let customers = await getCustomersAssociatedAPI(req.params.company_id, req.query.employee_id)
  let activeCustomers = customers.filter((cus) => cus.cus_status === 'Active').sort((a, b) => b.cus_name.localeCompare(a.cus_name))

  let projects = await DBSendResponse(`SELECT pro_id, pro_title, pro_customer_id FROM project WHERE pro_com_id=${req.params.company_id}`)
  projects = projects.sort((a, b) => b.pro_title.localeCompare(a.pro_title))

  const programId = getProgramIdFromReq(req);
  if (programId) {
    const allowedCustomerIds = await getProgramCustomerIds(programId);
    activeCustomers = activeCustomers.filter((customer) => allowedCustomerIds.has(Number(customer.cus_id)));
    const allowedProjectIds = await getProgramProjectIds(programId);
    projects = projects.filter((project) => allowedProjectIds.has(Number(project.pro_id)));
  }

  let artifacts = await DBSendResponse(`SELECT a.id, a.project_id, a.task_id, a.file_name, a.directory_id, a.customer_id, a.employee_id, a.submitted, a.url, e.emp_first_name + ' ' + e.emp_last_name AS emp_name, t.tas_title 
    FROM artifacts a LEFT JOIN employee e ON e.emp_id=a.employee_id LEFT JOIN task t ON t.tas_id=a.task_id WHERE a.show='true'`);

  let directories = []

  const duplicateCustomerNames = []

  activeCustomers.forEach((customer) => {
    let customer_name = customer.cus_name.replace(/\//g, "_");
    let customer_name_duplicate_count = duplicateCustomerNames.filter((name) => name === customer_name).length;

    duplicateCustomerNames.push(customer_name)
    if(customer_name_duplicate_count > 0) {
      customer_name += ` (${customer_name_duplicate_count})`
    }
    directories.push({
      cus_name: customers.cus_name,
      directory_name: customer.cus_name,
      file_path: "root/Artifacts/" + customer_name,
      directory_id: customer.cus_id,
      extID: req.params.company_id,
      directory_date_added: new Date(),
      file_id: null,
      file_name: null,
      emp_name: null,
      upload_date: null,
      file_url: null,
      locked: true
    })
    const customerProjects = projects.filter((project) => project.pro_customer_id === customer.cus_id)
    const duplicateProjectNames = []
    customerProjects.forEach((project) => {
      let project_name = project.pro_title.replace(/\//g, "_");
      let project_name_duplicate_count = duplicateProjectNames.filter((name) => name === project_name).length;

      duplicateProjectNames.push(project_name)
      if(project_name_duplicate_count > 0) {
        project_name += ` (${project_name_duplicate_count})`
      }
      directories.push({
        cus_name: null,
        directory_name: project.pro_title,
        file_path: "root/Artifacts/" + customer_name + "/" + project_name,
        directory_id: null,
        extID: req.params.company_id,
        directory_date_added: new Date(),
        file_id: null,
        file_name: null,
        emp_name: null,
        upload_date: null,
        file_url: null,
        locked: true
      })
      let pushedProjectArtifactNames = []
      let pushedTaskArtifactNames = []
      let pushedTaskDirectoryNames = []
      artifacts.forEach((artifact) => {
        if(artifact.project_id === project.pro_id && artifact.task_id === null) {
          let file_name = artifact.file_name;
          let file_ext = artifact.url.split('.').pop();
          let name_duplicate_count = pushedProjectArtifactNames.filter((name) => name === file_name + "." + file_ext).length;
  
          if(name_duplicate_count > 0) {
            file_name += ` (${name_duplicate_count})`
          }
  
          pushedProjectArtifactNames.push(artifact.file_name + "." + artifact.url.split('.').pop())
          directories.push({
            cus_name: customer.cus_name,
            directory_name: null,
            file_path: "root/Artifacts/" + customer_name + "/" + project.pro_title.replace(/\//g, "_"),
            directory_id: null,
            extID: req.params.company_id,
            directory_date_added: new Date(),
            file_id: artifact.id,
            file_name: file_name,
            emp_name: artifact.emp_name,
            upload_date: artifact.submitted,
            file_url: artifact.url
          }
        )}
        else if(artifact.project_id === project.pro_id && artifact.task_id !== null) {
          let file_name = artifact.file_name;
          let file_ext = artifact.url.split('.').pop();
          let name_duplicate_count = pushedTaskArtifactNames.filter((name) => name === file_name + "." + file_ext).length;
  
          if(name_duplicate_count > 0) {
            file_name += ` (${name_duplicate_count})`
          }
  
          pushedTaskArtifactNames.push(artifact.file_name + "." + artifact.url.split('.').pop())

          let task_title = artifact.tas_title.replace(/\//g, "_") + "	";
          let task_name_duplicate_count = pushedTaskDirectoryNames.filter((name) => name === task_title).length;

          if(task_name_duplicate_count === 0) {
            directories.push({
              cus_name: null,
              directory_name: artifact.tas_title,
              file_path: "root/Artifacts/" + customer_name + "/" + project_name + "/" + task_title,
              directory_id: null,
              extID: req.params.company_id,
              directory_date_added: new Date(),
              file_id: null,
              file_name: null,
              emp_name: null,
              upload_date: null,
              file_url: null,
              locked: true
            })
            pushedTaskDirectoryNames.push(task_title)
          }

          directories.push({
            cus_name: customer.cus_name,
            directory_name: null,
            file_path: "root/Artifacts/" + customer_name + "/" + project_name + "/" + task_title,
            directory_id: null,
            extID: req.params.company_id,
            directory_date_added: new Date(),
            file_id: artifact.id,
            file_name: file_name,
            emp_name: artifact.emp_name,
            upload_date: artifact.submitted,
            file_url: artifact.url,
            locked: true
          }
        )}
      })
    })
    let pushedArtifactNames = []
    artifacts.forEach((artifact) => {
      if(artifact.customer_id === customer.cus_id && artifact.project_id === null) {
        let file_name = artifact.file_name;
        let file_ext = artifact.url.split('.').pop();
        let name_duplicate_count = pushedArtifactNames.filter((name) => name === file_name + "." + file_ext).length;

        if(name_duplicate_count > 0) {
          file_name += ` (${name_duplicate_count})`
        }

        pushedArtifactNames.push(artifact.file_name + "." + artifact.url.split('.').pop())
        directories.push({
          cus_name: customer.cus_name,
          directory_name: null,
          file_path: "root/Artifacts/" + customer_name,
          directory_id: null,
          extID: req.params.company_id,
          directory_date_added: new Date(),
          file_id: artifact.id,
          file_name: file_name,
          emp_name: artifact.emp_name,
          upload_date: artifact.submitted,
          file_url: artifact.url,
          locked: true
       }
      )}
    })
  })

  res.json(directories)
}