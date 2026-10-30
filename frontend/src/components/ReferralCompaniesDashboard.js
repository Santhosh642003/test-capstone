import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  DataGridPro,
  GridToolbarColumnsButton,
  GridToolbarContainer,
  GridToolbarDensitySelector,
  GridToolbarExport,
  GridToolbarFilterButton,
} from "@mui/x-data-grid-pro";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import moment from "moment";
import FormsBuilder from "./FormsBuilder";
import { useNotify } from "./Feedback";

const ADD_NEW_FORM = "ADD_NEW_FORM";

const COMPANY_FIELDS = [
  { name: "company_name", label: "Company Name", required: true },
  { name: "company_address", label: "Company Address", required: true },
  { name: "company_phone", label: "Company Phone", required: true },
  { name: "referral_contact_name", label: "Contact Name" },
  {
    name: "referral_contact_email",
    label: "Contact Email",
    type: "email",
    helperText: "Email sending will be automatically enabled if contact email is provided",
  },
  { name: "selected_form_id", label: "Referral Form", select: true },
  { name: "referral_submission_url", label: "Submission URL" },
  { name: "referral_submission_payload", label: "Submission Payload", multiline: true, minRows: 3 },
];
const REQUIRED_FIELDS = COMPANY_FIELDS.filter((f) => f.required);
const EMPTY_COMPANY = Object.fromEntries(COMPANY_FIELDS.map(({ name }) => [name, ""]));

const validateCompany = (values) =>
  REQUIRED_FIELDS.every((f) => values[f.name]?.toString().trim())
    ? null
    : `${REQUIRED_FIELDS.map((f) => f.label.replace("Company ", "")).join(", ")} are required fields`;

// Email sending is derived from whether a contact email exists, not set directly.
const toPayload = (values) => ({
  company_name: values.company_name ?? "",
  company_address: values.company_address ?? "",
  company_phone: values.company_phone ?? "",
  referral_contact_name: values.referral_contact_name ?? "",
  referral_contact_email: values.referral_contact_email ?? "",
  can_send_referral_via_email: !!values.referral_contact_email?.trim(),
  selected_form_id: values.selected_form_id || "",
  referral_submission_url: values.referral_submission_url ?? "",
  referral_submission_payload: values.referral_submission_payload ?? "",
});

// The referral API answers HTTP 200 with { code: 500, message } on failure.
const unwrap = (response) => {
  if (response.data?.code === 500) throw new Error(response.data.message || "Request failed");
  return response.data;
};

const formLabel = (form) => form.form_name || form.form_description || `Form ${form.form_id}`;
const formatDate = (value) => (moment(value).isValid() ? moment(value).utc().format("MM/DD/YYYY") : "-");
const placeholder = <span style={{ color: "#999", fontStyle: "italic" }}>Click to select...</span>;

// Shared option list for the Referral Form pickers (grid edit cell + add dialog).
// Returned as a plain array so MUI Select sees MenuItems as direct children.
const formMenuItems = (forms) => [
  <MenuItem key="" value=""><em>None</em></MenuItem>,
  ...forms.map((form) => (
    <MenuItem key={form.form_id} value={form.form_id}>{formLabel(form)}</MenuItem>
  )),
  <MenuItem key={ADD_NEW_FORM} value={ADD_NEW_FORM} sx={{ borderTop: "1px solid #e0e0e0", color: "primary.main", fontWeight: "bold" }}>
    + Add New Form
  </MenuItem>,
];

function Toolbar({ selectedCount, onAdd, onDelete }) {
  return (
    <GridToolbarContainer sx={{ justifyContent: "space-between", p: 1 }}>
      <Stack direction="row" spacing={1}>
        <GridToolbarColumnsButton />
        <GridToolbarFilterButton />
        <GridToolbarDensitySelector />
        <GridToolbarExport />
      </Stack>
      <Stack direction="row" spacing={1}>
        <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={onAdd}>
          Add
        </Button>
        <Button variant="contained" size="small" startIcon={<DeleteIcon />} onClick={onDelete} disabled={selectedCount === 0}>
          Delete
        </Button>
      </Stack>
    </GridToolbarContainer>
  );
}

export default function ReferralCompaniesDashboard({ apiurl, environment, user }) {
  const notify = useNotify();
  const [companies, setCompanies] = useState([]);
  const [forms, setForms] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState([]);
  const [showFormBuilder, setShowFormBuilder] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [newCompany, setNewCompany] = useState(EMPTY_COMPANY);
  const [isSaving, setIsSaving] = useState(false);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [formsRes, companiesRes] = await Promise.all([
        axios.get(`${apiurl}/forms`),
        axios.get(`${apiurl}/referral`),
      ]);
      setForms((formsRes.data ?? []).filter((form) => form.public_form));
      setCompanies(unwrap(companiesRes).companies ?? []);
    } catch (err) {
      console.error("Error fetching company data:", err);
      notify("Error loading company data", "error");
    } finally {
      setIsLoading(false);
    }
  }, [apiurl, notify]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const formNames = useMemo(() => new Map(forms.map((form) => [form.form_id, formLabel(form)])), [forms]);

  const openFormBuilder = useCallback(() => {
    setShowAddDialog(false);
    setShowFormBuilder(true);
  }, []);

  const handleFormBuilderSuccess = () => {
    fetchData();
    setShowFormBuilder(false);
  };

  const processRowUpdate = async (newRow, oldRow) => {
    if (JSON.stringify(newRow) === JSON.stringify(oldRow)) return oldRow;

    const error = validateCompany(newRow);
    if (error) {
      notify(error, "error");
      return oldRow;
    }

    try {
      // Grid rows use the API's form_id; the PUT expects selected_form_id.
      const payload = toPayload({ ...newRow, selected_form_id: newRow.form_id });
      const { message } = unwrap(await axios.put(`${apiurl}/referral/${newRow.external_company_id}`, payload));
      notify(message || "Company updated successfully", "success");
      fetchData();
      return { ...newRow, can_send_referral_via_email: payload.can_send_referral_via_email };
    } catch (err) {
      console.error("Error updating details:", err);
      notify(err.message || "Error updating company details", "error");
      return oldRow;
    }
  };

  const createCompany = async () => {
    const error = validateCompany(newCompany);
    if (error) {
      notify(error, "error");
      return;
    }

    setIsSaving(true);
    try {
      const { message } = unwrap(await axios.post(`${apiurl}/referral`, toPayload(newCompany)));
      notify(message || "Company created successfully", "success");
      setShowAddDialog(false);
      setNewCompany(EMPTY_COMPANY);
      fetchData();
    } catch (err) {
      console.error("Error creating company:", err);
      notify(err.response?.data?.message || err.message || "Error creating company", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const deleteSelected = async () => {
    setIsSaving(true);
    const results = await Promise.allSettled(
      selectedIds.map((id) => axios.delete(`${apiurl}/referral/${id}`).then(unwrap))
    );
    const failed = results.filter((r) => r.status === "rejected");
    failed.forEach((r) => console.error("Error deleting company:", r.reason));

    const deleted = results.length - failed.length;
    notify(
      failed.length === 0 ? `Successfully deleted ${deleted} company(ies)` : `Deleted ${deleted} company(ies), ${failed.length} failed`,
      failed.length === 0 ? "success" : "warning"
    );
    setSelectedIds([]);
    setShowDeleteDialog(false);
    setIsSaving(false);
    fetchData();
  };

  const columns = useMemo(() => [
    { field: "external_company_id", headerName: "Company ID", width: 100 },
    { field: "company_name", headerName: "Company Name", flex: 2, editable: true },
    { field: "company_address", headerName: "Address", flex: 2, editable: true },
    { field: "company_phone", headerName: "Phone", flex: 1, editable: true },
    { field: "referral_contact_name", headerName: "Contact Name", flex: 1, editable: true },
    { field: "referral_contact_email", headerName: "Contact Email", flex: 2, editable: true },
    {
      field: "form_id",
      headerName: "Referral Form",
      flex: 1.5,
      editable: true,
      valueFormatter: ({ value }) => formNames.get(value) ?? "",
      renderCell: ({ value }) => formNames.get(value) ?? placeholder,
      renderEditCell: (params) => (
        <Select
          value={params.value || ""}
          fullWidth
          size="small"
          onChange={(e) => {
            if (e.target.value === ADD_NEW_FORM) {
              params.api.stopCellEditMode({ id: params.id, field: params.field, ignoreModifications: true });
              openFormBuilder();
            } else {
              params.api.setEditCellValue({ id: params.id, field: params.field, value: e.target.value });
            }
          }}
        >
          {formMenuItems(forms)}
        </Select>
      ),
    },
    { field: "can_send_referral_via_email", headerName: "Email Enabled", width: 120, type: "boolean" },
    { field: "referral_submission_url", headerName: "Submission URL", flex: 2, editable: true },
    { field: "referral_submission_payload", headerName: "Submission Payload", flex: 1, editable: true },
    { field: "created_at", headerName: "Created At", flex: 1, valueFormatter: ({ value }) => formatDate(value) },
    { field: "updated_at", headerName: "Updated At", flex: 1, valueFormatter: ({ value }) => formatDate(value) },
  ], [forms, formNames, openFormBuilder]);

  if (showFormBuilder) {
    return (
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "8px 8px 0" }}>
        <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
          <Button variant="outlined" onClick={() => setShowFormBuilder(false)}>← Back to Companies</Button>
          <Typography variant="h5">Create New Form</Typography>
        </Stack>
        <FormsBuilder
          apiurl={apiurl}
          env={environment}
          user={user}
          comp_id={user.comp_id}
          onSuccess={handleFormBuilderSuccess}
        />
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "8px 8px 0" }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Typography>List of external referral companies</Typography>
        <Button variant="contained" color="success" startIcon={<AddIcon />} onClick={openFormBuilder}>
          Add New Form
        </Button>
      </Stack>

      <div style={{ flex: 1, minHeight: 0 }}>
        <DataGridPro
          density="compact"
          rows={companies}
          getRowId={(row) => row.external_company_id}
          columns={columns}
          loading={isLoading}
          checkboxSelection
          disableSelectionOnClick
          selectionModel={selectedIds}
          onSelectionModelChange={setSelectedIds}
          processRowUpdate={processRowUpdate}
          onProcessRowUpdateError={(err) => {
            console.error(err);
            notify("An unexpected error occurred", "error");
          }}
          experimentalFeatures={{ newEditingApi: true }}
          showToolbar
          components={{ Toolbar }}
          componentsProps={{
            toolbar: {
              selectedCount: selectedIds.length,
              onAdd: () => setShowAddDialog(true),
              onDelete: () => setShowDeleteDialog(true),
            },
          }}
        />
      </div>

      <Dialog open={showAddDialog} onClose={() => setShowAddDialog(false)} maxWidth="md" fullWidth>
        <DialogTitle>Add New Referral Company</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {COMPANY_FIELDS.map(({ name, label, required, select, ...fieldProps }) => (
              <TextField
                key={name}
                label={label}
                required={required}
                select={select}
                value={newCompany[name]}
                onChange={(e) => {
                  if (select && e.target.value === ADD_NEW_FORM) {
                    openFormBuilder();
                  } else {
                    setNewCompany((prev) => ({ ...prev, [name]: e.target.value }));
                  }
                }}
                fullWidth
                {...fieldProps}
              >
                {select ? formMenuItems(forms) : null}
              </TextField>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowAddDialog(false)} disabled={isSaving}>Cancel</Button>
          <Button variant="contained" onClick={createCompany} disabled={isSaving}>Create Company</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={showDeleteDialog} onClose={() => setShowDeleteDialog(false)} maxWidth="xs">
        <DialogTitle>Delete {selectedIds.length} company(ies)?</DialogTitle>
        <DialogContent>This cannot be undone.</DialogContent>
        <DialogActions>
          <Button onClick={() => setShowDeleteDialog(false)} disabled={isSaving}>Cancel</Button>
          <Button variant="contained" color="error" onClick={deleteSelected} disabled={isSaving}>Delete</Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
