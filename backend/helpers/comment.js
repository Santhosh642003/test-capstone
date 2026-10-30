const { DBinsertSendID, DBUpdate, DBinsertSendResponse, DBSendResponse } = require("../queries/commonQueries");
const { getCustomersAssociatedAPI } = require('./customers.js');
const { addNotif } = require("./notifications");
var { SEGMENT_API_KEY } = require("../config");
const { Analytics } = require("@segment/analytics-node");
const analytics = new Analytics({ writeKey: SEGMENT_API_KEY });

function getRequestedEmployeeId(req) {
  return req.query.emp_id || req.query.empID || req.query.empId || null;
}

function getRequestedProgramId(req) {
  const parsed = parseInt(req.query.program_id, 10);
  return Number.isInteger(parsed) ? parsed : null;
}

// AI completeness score (0-100) for the note, when the author ran a rubric check.
// Coerced to a bounded integer so it is safe to inline into the SQL below.
function getRubricScore(body) {
  const score = Number(body?.note_quality_rubric_score);
  if (!Number.isFinite(score)) return null;
  return Math.round(Math.min(Math.max(score, 0), 100));
}

async function getAssociatedProgramIdsForComment(comment) {
  const programIds = new Set();

  if (comment?.proj_id) {
    const projectPrograms = await DBSendResponse(`SELECT DISTINCT pro_program_id AS program_id FROM project WHERE pro_id = ${comment.proj_id} AND pro_program_id IS NOT NULL`);
    projectPrograms.forEach((entry) => {
      if (entry?.program_id) {
        programIds.add(entry.program_id);
      }
    });
  }

  if (comment?.customer_id) {
    const customerProjects = await DBSendResponse(`SELECT DISTINCT pro_program_id AS program_id FROM project WHERE pro_customer_id = ${comment.customer_id} AND pro_program_id IS NOT NULL`);
    customerProjects.forEach((entry) => {
      if (entry?.program_id) {
        programIds.add(entry.program_id);
      }
    });
  }

  return [...programIds];
}

async function commentIsVisibleToEmployee(comment, empId) {
  if (!comment) {
    return false;
  }

  const privacyValue = comment?.note_privacy;
  if (privacyValue === undefined || privacyValue === null || privacyValue === '') {
    return true;
  }

  if (String(privacyValue).toLowerCase() !== 'private') {
    return true;
  }

  if (!empId) {
    return false;
  }

  if (Number(comment.emp_id) === Number(empId)) {
    return true;
  }

  const programIds = await getAssociatedProgramIdsForComment(comment);
  if (!programIds.length) {
    return false;
  }

  const matchingPrograms = await DBSendResponse(`
    SELECT TOP 1 1 AS match_found
    FROM program_association
    WHERE program_id IN (${programIds.join(',')})
      AND entity_type = 'employee'
      AND entity_id = ${empId}
  `);

  return matchingPrograms.length > 0;
}

async function filterVisibleComments(comments, empId) {
  if (!Array.isArray(comments)) {
    return [];
  }

  const visibleComments = [];
  for (const comment of comments) {
    if (await commentIsVisibleToEmployee(comment, empId)) {
      visibleComments.push(comment);
    }
  }

  return visibleComments;
}

async function commentBelongsToProgram(comment, programId) {
  if (!programId) {
    return true;
  }

  if (comment?.proj_id) {
    const projectMatch = await DBSendResponse(`SELECT TOP 1 1 AS match_found FROM project WHERE pro_id = ${comment.proj_id} AND pro_program_id = ${programId}`);
    if (projectMatch.length > 0) {
      return true;
    }
  }

  if (comment?.customer_id) {
    const customerProjectMatch = await DBSendResponse(`SELECT TOP 1 1 AS match_found FROM project WHERE pro_customer_id = ${comment.customer_id} AND pro_program_id = ${programId}`);
    if (customerProjectMatch.length > 0) {
      return true;
    }
  }

  return false;
}

async function filterCommentsByProgram(comments, programId) {
  if (!Array.isArray(comments) || !programId) {
    return comments;
  }

  const filtered = [];
  for (const comment of comments) {
    if (await commentBelongsToProgram(comment, programId)) {
      filtered.push(comment);
    }
  }
  return filtered;
}

async function getAllProjComments(req, res) {
  const query = `select * from comments where proj_id=${req.query.pro_id}`;
  let comment_List = await DBinsertSendResponse(query);
  const lastN = req.query.lastN;
  const requestedEmpId = getRequestedEmployeeId(req);
  const requestedProgramId = getRequestedProgramId(req);
  console.log(lastN);
  if (!!lastN && comment_List.length > lastN) {
    comment_List = comment_List.slice(Math.max(comment_List.length - lastN, 0));
  }
  comment_List = await filterCommentsByProgram(comment_List, requestedProgramId);
  comment_List = await filterVisibleComments(comment_List, requestedEmpId);
  res.json(comment_List);
}

async function getOneComment(req, res) {
  const query = `select * from comments where comment_id=${req.query.comment_id}`;
  const comment_List = await DBinsertSendResponse(query);
  const requestedEmpId = getRequestedEmployeeId(req);
  const requestedProgramId = getRequestedProgramId(req);
  let visibleComment = comment_List;
  if (visibleComment.length > 0) {
    const isProgramMatch = await commentBelongsToProgram(visibleComment[0], requestedProgramId);
    const isVisible = await commentIsVisibleToEmployee(visibleComment[0], requestedEmpId);
    visibleComment = isProgramMatch && isVisible ? visibleComment : [];
  }
  res.json(visibleComment);
}

async function getAllEmpComments(req, res) {
  const query = `select * from comments where emp_id=${req.query.emp_id}`;
  let comment_List = await DBinsertSendResponse(query);
  const lastN = req.query.lastN;
  const requestedEmpId = getRequestedEmployeeId(req);
  const requestedProgramId = getRequestedProgramId(req);
  console.log(lastN);
  if (!!lastN && comment_List.length > lastN) {
    comment_List = comment_List.slice(Math.max(comment_List.length - lastN, 0));
  }
  comment_List = await filterCommentsByProgram(comment_List, requestedProgramId);
  comment_List = await filterVisibleComments(comment_List, requestedEmpId);
  res.json(comment_List);
}

async function getAllCusComments(req, res) {
  const query = `select * from comments where customer_id=${req.query.customer_id}`;
  let comment_List = await DBinsertSendResponse(query);
  const requestedEmpId = getRequestedEmployeeId(req);
  const requestedProgramId = getRequestedProgramId(req);
  comment_List = await filterCommentsByProgram(comment_List, requestedProgramId);
  comment_List = await filterVisibleComments(comment_List, requestedEmpId);
  res.json(comment_List);
}

async function getAllCompanyComments(req, res) {
  let query = `select * from comments c inner join employee e on c.emp_id = e.emp_id where e.emp_company_id=${req.query.company_id}`;

  if (req.query.getCurrentMonth) {
    query += ` and YEAR(created_at) = YEAR(GETDATE()) AND MONTH(created_at) = MONTH(GETDATE())`;
  }

  let comment_List = await DBinsertSendResponse(query);
  const requestedEmpId = getRequestedEmployeeId(req);
  const requestedProgramId = getRequestedProgramId(req);
  comment_List = await filterCommentsByProgram(comment_List, requestedProgramId);
  comment_List = await filterVisibleComments(comment_List, requestedEmpId);
  res.json(comment_List);
}

exports.getComments = async function (req, res) {
  if (req.query.pro_id) {
    await getAllProjComments(req, res);
  } else if (req.query.emp_id) {
    await getAllEmpComments(req, res);
  } else if (req.query.comment_id) {
    await getOneComment(req, res);
  } else if (req.query.customer_id) {
    await getAllCusComments(req, res);
  } else if (req.query.company_id) {
    await getAllCompanyComments(req, res);
  } else {
    res.json({ code: 301, message: "You are missing Params" });
  }
};

exports.addComment = async function (req, res) {
  try {
    // Missing cus_id but have pro_id
    console.log(req.body);
    let found_cus_id = `NULL`;
    if (!!req.body.pro_id && !!!req.body.cus_id) {
      let found_cus_ids = await DBSendResponse(
        `select pro_customer_id from project where pro_id=${req.body.pro_id}`
      );
      if (found_cus_ids.length > 0) {
        found_cus_id = found_cus_ids[0].pro_customer_id;
      }
    }

    const rubricScore = getRubricScore(req.body);

    let query = `insert into comments (proj_id,emp_id,customer_id,task_id,comment_text,created_at,updated_at,updated_by,note_title,note_privacy,note_quality_rubric_score) values (
      ${!!req.body.pro_id ? req.body.pro_id : 'NULL'},
      ${!!req.body.emp_id ? req.body.emp_id : `NULL`},
      ${!!req.body.cus_id ? req.body.cus_id : found_cus_id},
      ${!!req.body.tas_id ? req.body.tas_id : `NULL`},
      '${String(req.body.comment_text).replaceAll("'", "''")}',
      CURRENT_TIMESTAMP, 
      CURRENT_TIMESTAMP,
      ${!!req.body.emp_id ? req.body.emp_id : `NULL`},
      ${req.body.note_title ? `'${String(req.body.note_title).replaceAll("'", "''")}'` : 'NULL'},
      '${req.body.note_privacy === 'private' ? 'private' : 'shared'}',
      ${rubricScore === null ? 'NULL' : rubricScore}
      ); SELECT SCOPE_IDENTITY()`;

    let projEmp = [];
    if (req.body.pro_id) {
      let proEmpQuery = `select * from projectEmployeeAssignment where pea_pro_id=${req.body.pro_id} and pea_is_active='true'`;
      projEmp = await DBSendResponse(proEmpQuery);
    }
    console.log(projEmp);
    const comment_Id = await DBinsertSendID(query);
    if (!comment_Id) {
      return res.json({ code: 500, message: "Comment Addition to DB Failed" });
    } else {
      let cusId = req.body.cus_id ? req.body.cus_id : found_cus_id;
      if (
        comment_Id &&
        req.body.empName &&
        req.body.companyId &&
        req.body.emp_id &&
        cusId &&
        req.body.tas_id
      ) {
        analytics.track({
          userId: String(req.body.emp_id),
          event: "New note added",
          context: {
            groupId: req.body.companyId,
          },
          properties: {
            uploadedBy: req.body.empName,
            taskId: req.body.tas_id,
            companyId: req.body.companyId,
            commentId: comment_Id,
            customerId: cusId,
          },
        });
        console.log("logged to segment successfully");
      }

      let notificationId = await Promise.all(
        projEmp.map(async (data) => {
          let notifPayload = {
            send_id: req.body.emp_id,
            rec_id: data.pea_emp_id,
            text: "New Comment Added",
            emp_id: data.pea_emp_id,
            pro_id: req.body.pro_id,
            comment_id: comment_Id,
          };
          let notif = await addNotif(
            { params: { notif_type: "comment" }, body: notifPayload },
            res,
            (notifSendId = true)
          );
          return notif;
        })
      );
      console.log(notificationId);
      res.json({
        code: 200,
        comment_data: {
          comment_id: comment_Id,
          comment_text: req.body.comment_text,
          pro_id: req.body.pro_id,
          emp_id: req.body.emp_id,
          tas_id: req.body.tas_id,
          cus_id: req.body.cus_id,
        },
        message: "Comment Added to DB Success",
      });
    }
  } catch (error) {
    console.log(error);
    res.json({ code: 500, message: "Comment Addition to DB Failed" });
  }
};

exports.updateComment = async function (req, res) {
  const rubricScore = getRubricScore(req.body);
  const query = `update comments SET comment_text='${String(req.body.comment_text).replaceAll("'", "''")}',updated_at=CURRENT_TIMESTAMP,updated_by=${!!req.body.updated_by ? req.body.updated_by : 'NULL'}${req.body.note_privacy ? `,note_privacy='${req.body.note_privacy === 'private' ? 'private' : 'shared'}'` : ''}${rubricScore === null ? '' : `,note_quality_rubric_score=${rubricScore}`} WHERE comment_id=${req.body.comment_id}`;
  const comment_update_res = await DBUpdate(query);
  if (comment_update_res === 0) {
    res.json({ code: 500, message: "Comment Update Failed" });
  }
  let cusId = req.body.cus_id;
  if (
    req.body.comment_id &&
    req.body.empName &&
    req.body.companyId &&
    req.body.emp_id &&
    cusId &&
    req.body.tas_id
  ) {
    analytics.track({
      userId: String(req.body.emp_id),
      event: "Note updated",
      context: {
        groupId: req.body.companyId,
      },
      properties: {
        uploadedBy: req.body.empName,
        taskId: req.body.tas_id,
        companyId: req.body.companyId,
        commentId: req.body.comment_id,
        customerId: cusId,
      },
    });
    console.log("logged to segment successfully");
  }
  res.json({
    code: 200,
    comment_data: {
      id: req.body.comment_id,
      comment_text: req.body.comment_text,
    },
    message: "Comment Update Success",
  });
};

exports.delComment = async function (req, res) {
  const query = `update comments SET isDeleted='${req.body.isDeleted}' WHERE comment_id=${req.body.comment_id}`;
  const comment_update_res = await DBUpdate(query);
  if (comment_update_res === 0) {
    res.json({ code: 500, message: "Comment Update Failed" });
  }
  res.json({
    code: 200,
    comment_data: { id: req.body.comment_id, isDeleted: req.body.isDeleted },
    message: "Comment Update Success",
  });
};

exports.getDetailedComments = async function (req, res) {
  if (req.query.comment_id) {
    const requestedProgramId = getRequestedProgramId(req);
    const query = `SELECT
        comments.*, 
        project.*, 
        task.*, 
        customer.*, 
        employee.*, 
        e2.emp_id AS updated_emp_id,
        e2.emp_first_name AS updated_emp_first_name,
        e2.emp_last_name AS updated_emp_last_name
    FROM comments
    LEFT JOIN project ON comments.proj_id = project.pro_id
    LEFT JOIN task ON comments.task_id = task.tas_id
    LEFT JOIN customer ON comments.customer_id = customer.cus_id
    LEFT JOIN employee AS e2 ON comments.updated_by = e2.emp_id
    LEFT JOIN employee ON comments.emp_id = employee.emp_id
    WHERE comments.comment_id = ${req.query.comment_id} AND (task.tas_is_active != 2 OR task.tas_is_active IS NULL)${requestedProgramId ? ` AND project.pro_program_id = ${requestedProgramId}` : ''};`

    const commentData = await DBSendResponse(query);
    const requestedEmpId = getRequestedEmployeeId(req);
    const visibleCommentData = commentData.length > 0 && await commentIsVisibleToEmployee(commentData[0], requestedEmpId) ? commentData : [];

    res.json(visibleCommentData);
  }
};

exports.getRecentNotes = async function (req, res) {
  try {
    const associatedCustomers = await getCustomersAssociatedAPI(req.query.compID, req.query.empID);
    const cus_ids = associatedCustomers.filter((customer) => customer.cus_status === 'Active').map((customer) => customer.cus_id);

    const getRecentComments = `
      SELECT TOP 5 * 
      FROM comments c
      JOIN customer cus ON cus.cus_id = c.customer_id
      JOIN employee e ON e.emp_id = c.emp_id
      WHERE c.customer_id IN (${(cus_ids && cus_ids.length > 0) ? cus_ids : -1})
      ORDER BY c.created_at DESC
    `;
    const recentComments = await DBSendResponse(getRecentComments);
    const requestedEmpId = getRequestedEmployeeId(req);
    const visibleRecentComments = await filterVisibleComments(recentComments, requestedEmpId);

    return res.status(200).json(visibleRecentComments);
  } catch (err) {
    console.log('QUERY FAILURE | getRecentNotes Query Failed:')
    console.log(err)
    return res.status(400).json({
      message: 'An unexpected error occured',
    })
  }
};