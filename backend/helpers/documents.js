const azureStorage = require("azure-storage");
var fs = require("fs");
const streamifier = require("streamifier");
const { BLOB_KEY, DOCUMENTS_CONTAINER_NAME } = require("../config");

const blobService = azureStorage.createBlobService(
  `DefaultEndpointsProtocol=https;AccountName=fieldworkblob;AccountKey=${BLOB_KEY};EndpointSuffix=core.windows.net`
);
const containerName = DOCUMENTS_CONTAINER_NAME;

const uploadFile = async (request, response) => {
  if (!request.files) {
    return response.status(400).send("No files are received.");
  }

  const file = request.files.File;

  const user_id = request.body.user_id;

  if (user_id === undefined) {
    return response.status(400).send("User Id is not defined.");
  }

  if (typeof user_id !== "string") {
    return response.status(400).send("User Id must be of type string");
  }

  if (user_id.trim().length == 0) {
    return response.status(400).send("User Id cannot be an empty string.");
  }

  const blobName = user_id + "/" + file.name;

  const stream = streamifier.createReadStream(file.data);

  if (stream === undefined) {
    return response.status(400).send("Cannot convert file buffer to a stream.");
  }

  blobService.listBlobsSegmentedWithPrefix(
    containerName,
    blobName,
    null,
    (error, result) => {
      if (error) {
        return response
          .status(500)
          .send({ message: `Error Occured! ${error.code}` });
      } else {
        if (result.entries.length !== 0) {
          return response
            .status(400)
            .send(
              "Error! File already exists. Please upload a file with another name or delete the exisiting file"
            );
        } else {
          blobService.createBlockBlobFromStream(
            containerName,
            blobName,
            stream,
            file.size,
            (err) => {
              if (err) {
                response.status(500);
                response.send({ message: "Error Occured! Cannot upload file" });
                return;
              }
              response
                .status(200)
                .send({ message: "File Uploaded Successfully" });
            }
          );
        }
      }
    }
  );
};

const deleteFile = async (request, response) => {
  const fileName = request.query.fileName;
  const user_id = request.query.user_id;

  if (fileName === undefined) {
    return response.status(400).send("Please provide the file name to delete.");
  }

  if (typeof fileName !== "string") {
    return response.status(400).send("File name must be of string type.");
  }

  if (user_id === undefined) {
    return response.status(400).send("User Id is not defined.");
  }

  if (typeof user_id !== "string") {
    return response.status(400).send("User Id must be of type string");
  }

  if (user_id.trim().length == 0) {
    return response.status(400).send("User Id cannot be an empty string.");
  }

  if (fileName.trim().length === 0) {
    return response
      .status(400)
      .send("File name cannot just have trailing spaces.");
  }

  const blobName = user_id + "/" + fileName;

  blobService.deleteBlob(containerName, blobName, (error) => {
    if (error) {
      console.log(error);
      return response
        .status(500)
        .send({ message: `Error Occured! ${error.code}` });
    } else {
      return response
        .status(200)
        .send({ message: "File Deleted Successfully!" });
    }
  });
};

const getFile = async (request, response) => {
  const fileName = request.query.fileName;
  const user_id = request.query.user_id;

  if (fileName === undefined) {
    return response.status(400).send("Please provide the file name.");
  }
  if (typeof fileName !== "string") {
    return response.status(400).send("File name must be of string type.");
  }

  if (fileName.trim().length === 0) {
    return response
      .status(400)
      .send("File name cannot just have trailing spaces.");
  }

  if (user_id === undefined) {
    return response.status(400).send("User Id is not defined.");
  }

  if (typeof user_id !== "string") {
    return response.status(400).send("User Id must be of type string");
  }

  if (user_id.trim().length == 0) {
    return response.status(400).send("User Id cannot be an empty string.");
  }

  const blobName = user_id + "/" + fileName;

  const listFileName = fileName.split("/");
  const tempFileName = user_id + "/" + listFileName[listFileName.length - 1];

  fs.mkdirSync("./public/" + user_id);

  blobService.getBlobToStream(
    containerName,
    blobName,
    fs.WriteStream("./public/" + tempFileName),
    function (error, result) {
      if (error) {
        console.log(error);
        fs.unlinkSync("./public/" + tempFileName);
        fs.rmdirSync(`./public/${user_id}`);
        return response
          .status(500)
          .send({ message: `Error Occured! ${error.code}` });
      } else {
        return response
          .status(200)
          .download("./public/" + tempFileName, (error) => {
            if (error) {
              console.log(error);
            } else {
              fs.unlinkSync("./public/" + tempFileName);
              fs.rmdirSync(`./public/${user_id}`);
            }
          });
      }
    }
  );
};

const getUserFiles = (request, response) => {
  const user_id = request.query.user_id;

  if (user_id === undefined) {
    return response.status(400).send("User Id is not defined.");
  }

  if (typeof user_id !== "string") {
    return response.status(400).send("User Id must be of type string");
  }

  if (user_id.trim().length == 0) {
    return response.status(400).send("User Id cannot be an empty string.");
  }

  blobService.listBlobsSegmentedWithPrefix(
    containerName,
    user_id + "/",
    null,
    (err, result) => {
      if (err) {
        response.status(500);
        response.send({
          message: "Error Occured! Cannot get the file names of user",
        });
        return;
      } else {
        const userFiles = result.entries.map((document) => {
          const modifiedDocument = {};

          const modifiedName = document.name.split("/").slice(1).join("/");

          modifiedDocument.name = modifiedName;
          modifiedDocument.creationTime = document.creationTime;
          modifiedDocument.lastModified = document.lastModified;
          return modifiedDocument;
        });
        return response.status(200).send(userFiles);
      }
    }
  );
};

exports.uploadFile = uploadFile;
exports.deleteFile = deleteFile;
exports.getFile = getFile;
exports.getUserFiles = getUserFiles;
