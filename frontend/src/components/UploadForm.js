import React, { useCallback, useMemo, useState } from "react";
import axios from "axios";
import Dropzone from "react-dropzone";
import moment from "moment";
import {
  Backdrop,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Tooltip,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { DataGridPro, GridToolbar } from "@mui/x-data-grid-pro";
import { useNotify } from "./Feedback";

const PAGE_SIZE = 20;

// ---- shared cell renderers -------------------------------------------------

const tooltipCell = ({ value }) => (
  <Tooltip title={value ?? ""}><div>{value}</div></Tooltip>
);
const coloredCell = (color) => ({ value }) => (
  <span style={{ color, fontWeight: "bold" }}>{value}</span>
);
const formatDate = (value) => moment(value).utc().format("MM/DD/YYYY");
const centered = { align: "center", headerAlign: "center" };

const NAME_COLUMNS = [
  { field: "FirstName", headerName: "First Name", width: 130, renderCell: tooltipCell },
  { field: "LastName", headerName: "Last Name", width: 130, renderCell: tooltipCell },
];

// ---- 999: acknowledgement per claim ----------------------------------------

const COLUMNS_999 = [
  { field: "claim_ID", headerName: "Claim ID", width: 120 },
  {
    field: "DDDID",
    headerName: "DDDID",
    width: 120,
    renderCell: ({ row, value }) => (
      <Tooltip title={row.errDescription || "No errors found."}><div>{value}</div></Tooltip>
    ),
  },
  ...NAME_COLUMNS,
  { field: "priorAuth", headerName: "Prior Auth", width: 110 },
  {
    field: "status999",
    headerName: "999 Status",
    width: 90,
    renderCell: ({ row, value }) => {
      const accepted = value === "Accepted";
      const label = accepted ? "Accepted" : value === "Rejected" ? "Rejected" : "Not found";
      const fallback = accepted ? "No errors found." : "Not found in our database.";
      return (
        <Tooltip title={row.errDescription || fallback}>
          <span style={{ color: accepted ? "green" : "red", fontWeight: "bold" }}>{label}</span>
        </Tooltip>
      );
    },
  },
  { field: "errDescription", headerName: "Error Description", width: 90, hide: true },
];

// ---- 835: remittance summary per company, denied claims in a detail panel ----

const DENIED_COLUMNS = [
  { field: "DDDID", headerName: "DDDID", flex: 0.4, ...centered },
  { field: "FirstName", headerName: "First Name", flex: 0.6, ...centered },
  { field: "LastName", headerName: "Last Name", flex: 0.6, ...centered },
  { field: "priorAuth", headerName: "Prior Auth", flex: 0.6, ...centered },
  { field: "startDate", headerName: "Start Date", flex: 0.6, ...centered, valueFormatter: ({ value }) => formatDate(value) },
  { field: "endDate", headerName: "End Date", flex: 0.6, ...centered, valueFormatter: ({ value }) => formatDate(value) },
  { field: "errorCodes", headerName: "Error Codes", flex: 0.6, ...centered },
  {
    field: "errDescription",
    headerName: "Error Description",
    flex: 1.5,
    headerAlign: "center",
    renderCell: ({ value }) => (
      <Tooltip title={value ?? ""}>
        <Box sx={{ height: "80%", width: "100%", overflowY: "auto", whiteSpace: "pre-wrap", overflowWrap: "break-word" }}>
          {value}
        </Box>
      </Tooltip>
    ),
  },
];

function DeniedClaimsTitle() {
  return (
    <Box sx={{ width: "100%", display: "flex", justifyContent: "center", alignItems: "center" }}>
      <Typography>Denied Claims</Typography>
    </Box>
  );
}

function DeniedClaimsPanel({ row }) {
  const rows = useMemo(() => row.denied.map((claim, index) => ({ ...claim, id: index })), [row.denied]);
  if (rows.length === 0) return null;
  return (
    <DataGridPro
      rows={rows}
      columns={DENIED_COLUMNS}
      rowHeight={150}
      components={{ Toolbar: DeniedClaimsTitle }}
      sx={{ flex: 1, maxHeight: "100%" }}
      hideFooter
    />
  );
}

const COLUMNS_835 = [
  { field: "com_name", headerName: "Company", flex: 1, renderCell: tooltipCell },
  { field: "processed", headerName: "Processed", flex: 0.5, renderCell: coloredCell("green") },
  { field: "denied", headerName: "Denied", flex: 0.5, valueGetter: ({ value }) => value.length, renderCell: coloredCell("red") },
  {
    field: "totalClaims",
    headerName: "Total",
    flex: 0.5,
    valueGetter: ({ row }) => row.processed + row.denied.length,
    renderCell: coloredCell("grey"),
  },
];

// ---- 277: pending claim status per claim -------------------------------------

const COLUMNS_277 = [
  { field: "claim_ID", headerName: "Claim ID", flex: 1 },
  { field: "DDDID", headerName: "DDDID", flex: 1 },
  ...NAME_COLUMNS.map((col) => ({ ...col, flex: 1 })),
  { field: "priorAuth", headerName: "Prior Auth", flex: 1 },
  { field: "Status", headerName: "Status", flex: 1, renderCell: coloredCell("orange") },
  { field: "errorCodes", headerName: "Error Codes", flex: 1 },
  { field: "errDescription", headerName: "Error Description", flex: 3, renderCell: tooltipCell },
];

// ---- per-mode behaviour --------------------------------------------------------

const plural = (n, noun) => `${n} ${noun}${n === 1 ? " was" : "s were"}`;

const MODES = {
  999: {
    extension: "a97",
    columns: COLUMNS_999,
    rows: (data) => data.detailedData ?? [],
    summary: (data) => data.notFound === 0
      ? { severity: "success", message: `Total claims found : ${data.acceptedIDs + data.rejectedIDs}, Accepted claims : ${data.acceptedIDs}, Rejected : ${data.rejectedIDs}, Total Claim Status Updates = ${data.claimsUpdated}` }
      : { severity: "error", message: `${plural(data.notFound, "claim")} not found in our database!` },
  },
  835: {
    extension: "rmt",
    columns: COLUMNS_835,
    payloadExtras: (user) => ({ empId: user.emp_id }),
    detailPanel: true,
    rows: (data) => data.detailedData ?? [],
    summary: (data) => ({
      severity: "success",
      message: `Total claims found : ${data.processed.length + data.denied.length}, Accepted claims : ${data.processed.length}, Rejected : ${data.denied.length}, Total Claim Status Updates = ${data.foundInDB.length}`,
    }),
  },
  277: {
    extension: "277",
    columns: COLUMNS_277,
    rows: (data) => data.foundInDB ?? [],
    emptyMessage: "No pending claims were found in this file.",
    summary: (data) => ({ severity: "success", message: `Total claims found : ${data.foundInDB.length}` }),
  },
};

const fileExtension = (name) => name.split(".").pop().toLowerCase();

export default function UploadForm({ apiurl, user, mode }) {
  const notify = useNotify();
  const config = MODES[mode];
  const [file, setFile] = useState(null);
  const [isParsing, setIsParsing] = useState(false);
  const [results, setResults] = useState(null); // rows for the status report dialog, null = closed

  const rows = useMemo(() => (results ?? []).map((row, index) => ({ ...row, id: index })), [results]);

  const getDetailPanelHeight = useCallback(() => 400, []);
  const getDetailPanelContent = useCallback(({ row }) => <DeniedClaimsPanel row={row} />, []);

  const uploadFile = async () => {
    if (!file) {
      notify("Please select a file to upload!", "error");
      return;
    }
    if (fileExtension(file.name) !== config.extension) {
      notify("Incorrect type of file, please try again!", "error");
      return;
    }

    setIsParsing(true);
    try {
      const dataToBeParsed = await file.text();
      const { data } = await axios.put(`${apiurl}/billing`, {
        dataToBeParsed,
        typeOfData: mode,
        ...config.payloadExtras?.(user),
      });
      const { message, severity } = config.summary(data);
      notify(message, severity);
      setResults(config.rows(data));
    } catch (err) {
      console.error(err);
      const serverError = err?.response?.data?.error;
      notify(serverError ? `Something went wrong! ${serverError}` : "Something went wrong! Please try again.", "error");
    } finally {
      setFile(null);
      setIsParsing(false);
    }
  };

  return (
    <div>
      <Dialog
        open={results !== null}
        onClose={() => setResults(null)}
        fullWidth
        maxWidth="lg"
        PaperProps={{ sx: { height: "80%" } }}
      >
        <DialogTitle>
          Status Report
          <IconButton onClick={() => setResults(null)} aria-label="close" color="inherit" sx={{ position: "absolute", right: 8, top: 8 }}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ pt: 0, display: "flex" }}>
          {rows.length === 0 && config.emptyMessage ? (
            <Typography variant="h6" sx={{ m: "auto" }}>{config.emptyMessage}</Typography>
          ) : (
            <DataGridPro
              rows={rows}
              columns={config.columns}
              pagination
              pageSize={PAGE_SIZE}
              rowsPerPageOptions={[PAGE_SIZE]}
              showToolbar={config.detailPanel}
              components={config.detailPanel ? { Toolbar: GridToolbar } : undefined}
              getDetailPanelHeight={config.detailPanel ? getDetailPanelHeight : undefined}
              getDetailPanelContent={config.detailPanel ? getDetailPanelContent : undefined}
              sx={{ flex: 1 }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Backdrop open={isParsing} sx={{ zIndex: (theme) => theme.zIndex.modal + 1, flexDirection: "column", gap: 2, bgcolor: "rgba(16, 16, 16, 0.8)" }}>
        <CircularProgress size={75} sx={{ color: "#3fa7d6" }} />
        <Typography sx={{ color: "#3fa7d6" }}>Please wait, file is being parsed</Typography>
      </Backdrop>

      <Dropzone onDrop={(accepted) => setFile(accepted[0] ?? null)} multiple={false}>
        {({ getRootProps, getInputProps }) => (
          <Box
            {...getRootProps()}
            sx={{
              mt: 2,
              mb: 2.5,
              height: 125,
              border: "2px dashed lightgray",
              borderRadius: "20px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <Typography variant="subtitle1" align="center">
              {file ? file.name : "Drop file here or click to upload"}
            </Typography>
            {!file && <Typography variant="caption">(file type: .{config.extension})</Typography>}
            <input {...getInputProps()} />
          </Box>
        )}
      </Dropzone>
      <Button variant="contained" fullWidth onClick={uploadFile} disabled={isParsing}>
        Upload File
      </Button>
    </div>
  );
}
