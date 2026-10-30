import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { DataGridPro, GridToolbar } from "@mui/x-data-grid-pro";
import {
  Autocomplete,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Link,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import moment from "moment";
import Upload from "./Upload";
import { useNotify } from "./Feedback";

const UPLOAD_MODES = ["999", "835", "277"];

// Statuses a claim file can move to from its current one.
const NEXT_STATUSES = {
  READY: ["UPLOADED", "999RECD", "835RECD"],
  UPLOADED: ["999RECD", "835RECD"],
};
const nextStatuses = (status) => NEXT_STATUSES[status] ?? ["835RECD"];

const hasResponse = (status) => status === "999RECD" || status === "835RECD";
const formatDate = (value) => moment(value).utc().format("MM/DD/YYYY");
const today = () => moment().utc().format("MM/DD/YYYY");

const statusText = (text, ok) => (
  <span style={{ color: ok ? "green" : "red", fontWeight: "bold" }}>{text}</span>
);
const mutedText = (text) => <span style={{ color: "gray" }}>{text}</span>;
const noStatus = <Button variant="outlined" size="small" disabled>NO STATUS</Button>;

// Fetches the generated X12 file from blob storage and saves it as <Filename>.dat
async function downloadFile(row, onError) {
  try {
    const response = await fetch(row.FileLocation);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    const url = window.URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${row.Filename}.dat`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  } catch (err) {
    console.error(err);
    onError();
  }
}

export default function BillingOps({ apiurl, user }) {
  const notify = useNotify();
  const [billing, setBilling] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  // Upload dialog: `uploadMode` is kept after close so the form doesn't flash empty during the exit transition.
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadMode, setUploadMode] = useState(UPLOAD_MODES[0]);
  // Status-change dialog: null when closed, otherwise the row being edited plus the form values.
  const [editing, setEditing] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    axios.get(`${apiurl}/billing`)
      .then(({ data }) => {
        if (!cancelled) setBilling(data.billing ?? []);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) notify("Failed to load billing operations. Check the browser log for details.", "error");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, [apiurl, notify]);

  const readyRows = useMemo(() => billing.filter((row) => row.Status === "READY"), [billing]);
  const completedRows = useMemo(() => billing.filter((row) => row.Status === "835RECD"), [billing]);
  const statusTabs = [
    { value: "all", label: "All", rows: billing },
    { value: "ready", label: "Ready to upload", rows: readyRows },
    { value: "complete", label: "Completed", rows: completedRows },
  ];
  const visibleRows = statusTabs.find((tab) => tab.value === statusFilter)?.rows ?? billing;

  const openUpload = (mode) => {
    setUploadMode(mode);
    setUploadOpen(true);
  };

  const openStatusEditor = (row) => setEditing({ row, status: null, note: "" });
  const closeStatusEditor = () => setEditing(null);

  // Moving to UPLOADED stamps the submit date; any response status stamps the response date.
  const saveStatus = async () => {
    const { row, status, note } = editing;
    const notes = [row.notes, note.trim()].filter(Boolean).join("|");
    const changes = status === "UPLOADED"
      ? { Status: status, SubmitDate: today(), LastResponseDate: "", notes }
      : { Status: status, SubmitDate: row.SubmitDate, LastResponseDate: today(), notes };

    setIsSaving(true);
    try {
      await axios.put(`${apiurl}/billing`, { ID: row.ID, ...changes });
      setBilling((prev) => prev.map((r) => (r.ID === row.ID ? { ...r, ...changes } : r)));
      notify("Upload status updated", "success");
      closeStatusEditor();
    } catch (err) {
      console.error(err);
      notify("Failed to update status. Check the browser log for details.", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const columns = [
    { field: "ID", headerName: "id", hide: true },
    { field: "companyID", headerName: "Company ID", flex: 0.7 },
    { field: "uploadedBy", headerName: "Uploader", flex: 1.1 },
    {
      field: "com_name",
      headerName: "Medicaid Provider",
      flex: 1.5,
      renderCell: ({ value }) => (
        <Tooltip title={value}>
          <span style={{ textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>{value}</span>
        </Tooltip>
      ),
    },
    {
      field: "Filename",
      headerName: "File Name",
      flex: 0.7,
      renderCell: ({ row, value }) => (
        <Tooltip title="Click to download the file">
          <Link
            component="button"
            underline="hover"
            onClick={() => downloadFile(row, () => notify("Failed to download file. Check the browser log for details.", "error"))}
          >
            {value}
          </Link>
        </Tooltip>
      ),
    },
    {
      field: "CreateDate",
      headerName: "Created Date",
      flex: 0.9,
      valueFormatter: ({ value }) => formatDate(value),
    },
    {
      field: "Status",
      headerName: "Upload Status",
      flex: 1,
      renderCell: ({ row, value }) => (
        <Stack direction="row" alignItems="center">
          <IconButton size="small" disabled={value === "835RECD"} onClick={() => openStatusEditor(row)}>
            <EditIcon fontSize="small" />
          </IconButton>
          {statusText(value, value !== "REJECTED")}
        </Stack>
      ),
    },
    {
      field: "SubmitDate",
      headerName: "Upload Date",
      flex: 0.8,
      renderCell: ({ row, value }) => (row.Status === "READY" ? mutedText("Yet to upload") : formatDate(value)),
    },
    {
      field: "_999",
      headerName: "999RECD",
      flex: 0.8,
      renderCell: ({ row, value }) =>
        hasResponse(row.Status) ? statusText("AVAILABLE", true)
          : value === "FAILED" ? statusText("FAILED", false)
            : noStatus,
    },
    {
      field: "_835",
      headerName: "835RECD",
      flex: 0.8,
      renderCell: ({ row, value }) =>
        row.Status === "835RECD" ? statusText("AVAILABLE", true)
          : value === "FAILED" ? statusText("FAILED", false)
            : noStatus,
    },
    {
      field: "LastResponseDate",
      headerName: "Response Date",
      flex: 0.9,
      renderCell: ({ row, value }) => (hasResponse(row.Status) ? formatDate(value) : mutedText("No Response")),
    },
  ];

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "8px 8px 0" }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
        <ToggleButtonGroup
          value={statusFilter}
          exclusive
          size="small"
          color="primary"
          onChange={(e, value) => value !== null && setStatusFilter(value)}
        >
          {statusTabs.map((tab) => (
            <ToggleButton key={tab.value} value={tab.value} sx={{ textTransform: "none", gap: 1, px: 2 }}>
              {tab.label}
              <Chip
                label={tab.rows.length}
                size="small"
                color={statusFilter === tab.value ? "primary" : "default"}
                sx={{ height: 20, fontSize: 11 }}
              />
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <Stack direction="row" spacing={1} sx={{ marginLeft: "auto" }}>
          {UPLOAD_MODES.map((mode) => (
            <Button key={mode} variant="contained" onClick={() => openUpload(mode)}>
              {mode} Upload
            </Button>
          ))}
        </Stack>
      </div>

      <div style={{ flex: 1, minHeight: 0 }}>
        <DataGridPro
          density="compact"
          rows={visibleRows}
          getRowId={(row) => row.ID}
          columns={columns}
          showToolbar
          components={{ Toolbar: GridToolbar }}
          initialState={{ sorting: { sortModel: [{ field: "CreateDate", sort: "desc" }] } }}
          disableSelectionOnClick
          loading={isLoading}
        />
      </div>

      <Upload open={uploadOpen} onClose={() => setUploadOpen(false)} mode={uploadMode} apiurl={apiurl} user={user} />

      <Dialog open={!!editing} onClose={closeStatusEditor}>
        <DialogTitle>Change Upload Status</DialogTitle>
        <DialogContent sx={{ width: 500, pt: 1 }}>
          {editing && (
            <Stack spacing={3} sx={{ mt: 1 }}>
              <Autocomplete
                disablePortal
                options={nextStatuses(editing.row.Status)}
                value={editing.status}
                onChange={(e, value) => setEditing((prev) => ({ ...prev, status: value }))}
                renderInput={(params) => <TextField {...params} label="Select Status" />}
              />
              <TextField
                label="Notes"
                multiline
                minRows={1}
                inputProps={{ maxLength: 2000 }}
                value={editing.note}
                onChange={(e) => setEditing((prev) => ({ ...prev, note: e.target.value }))}
              />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button variant="outlined" onClick={closeStatusEditor} disabled={isSaving}>Cancel</Button>
          <Button variant="contained" onClick={saveStatus} disabled={!editing?.status || isSaving}>Add</Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
