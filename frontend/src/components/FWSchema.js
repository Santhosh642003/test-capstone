import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Autocomplete, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography } from "@mui/material";
import { DataGridPro, GridToolbar } from '@mui/x-data-grid-pro';
import EditIcon from '@mui/icons-material/Edit';
import axios from "axios";
import { useNotify } from './Feedback';
import { COMPANY_TYPE_NAMES } from '../constants';

// companyID / companyTypeOfBusiness of -1 marks the global default schema rows
const DEFAULT_SCOPE = -1;

const EDITABLE_FIELDS = {
    columnLabel: 'Column Label',
    columnVisible: 'Column Visible',
    columnOptional: 'Column Optional',
};

// Generic placeholder columns (place01char, place12date, ...) get a readable name in the grid.
const PLACEHOLDER_TYPES = { char: 'Text', date: 'Date', number: 'Number' };
const displayColumnName = (name) => {
    const match = /^place(\d{2})(char|date|number)$/i.exec(name);
    return match ? `Field ${match[1]} (${PLACEHOLDER_TYPES[match[2].toLowerCase()]})` : name;
};

const wrappedHeader = (label) => () => (
    <div style={{ whiteSpace: "normal", textAlign: "left", lineHeight: 1.2 }}>{label}</div>
);

const editableHeader = (label) => () => (
    <div style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ whiteSpace: "normal", textAlign: "left", lineHeight: 1.2 }}>{label}</div>
        <EditIcon fontSize="small" style={{ color: '#1976d2', marginLeft: 5, marginRight: 5 }} />
    </div>
);

const yesNoColumn = (field, label) => ({
    field,
    headerName: label,
    width: 100,
    editable: true,
    type: 'singleSelect',
    valueOptions: ['Yes', 'No'],
    renderHeader: editableHeader(`${label}?`),
});

const columns = [
    {
        field: "columnName",
        headerName: "Column Name",
        width: 200,
        valueFormatter: ({ value }) => displayColumnName(value),
    },
    {
        field: "columnLabel",
        headerName: "Column Label",
        width: 200,
        editable: true,
        renderHeader: editableHeader("Column Label"),
    },
    yesNoColumn("columnVisible", "Column Visible"),
    yesNoColumn("columnOptional", "Column Optional"),
    {
        field: "companyID",
        headerName: "Company ID",
        width: 100,
        renderHeader: wrappedHeader("Company ID"),
        valueFormatter: ({ value }) => (value === DEFAULT_SCOPE ? 'DEFAULT' : value),
    },
    {
        field: "companyState",
        headerName: "Company State",
        width: 80,
        renderHeader: wrappedHeader("Company State"),
    },
    {
        field: "companyTypeOfBusiness",
        headerName: "Company Type Of Business",
        width: 200,
        valueFormatter: ({ value }) => (value === DEFAULT_SCOPE ? 'DEFAULT' : COMPANY_TYPE_NAMES[value] ?? value),
    },
];

export default function FWSchema({ apiurl, user }) {
    const notify = useNotify();
    const [companyTypes, setCompanyTypes] = useState([]);
    const [companies, setCompanies] = useState([]);
    const [selectedCompanyType, setSelectedCompanyType] = useState(null);
    const [selectedCompany, setSelectedCompany] = useState(null);
    const [isDropdownLoading, setIsDropdownLoading] = useState(true);
    const [rows, setRows] = useState([]);
    const [isSchemaLoading, setIsSchemaLoading] = useState(false);
    // The edit awaiting confirmation: { newRow, oldRow, field, resolve }. Resolving the
    // promise is what tells the grid whether to keep the new value or revert.
    const [pendingEdit, setPendingEdit] = useState(null);

    useEffect(() => {
        let cancelled = false;
        Promise.all([
            axios.get(`${apiurl}/company/companyTypes`),
            axios.get(`${apiurl}/company/companyList`),
        ])
            .then(([types, list]) => {
                if (cancelled) return;
                setCompanyTypes(types.data ?? []);
                setCompanies(list.data ?? []);
            })
            .catch((err) => {
                console.error(err);
                if (!cancelled) notify("Failed to load companies. Check the browser log for details.", "error");
            })
            .finally(() => {
                if (!cancelled) setIsDropdownLoading(false);
            });
        return () => { cancelled = true; };
    }, [apiurl, notify]);

    // Falls back to the global default schema when the selected type/company has none of its own.
    const scopeParams = useMemo(() => (
        selectedCompanyType ? { companyTypeOfBusiness: selectedCompanyType.feature_id }
            : selectedCompany ? { companyID: selectedCompany.com_id }
                : null
    ), [selectedCompanyType, selectedCompany]);

    const fetchSchema = useCallback(async () => {
        if (!scopeParams) return;
        setIsSchemaLoading(true);
        try {
            const { data } = await axios.get(`${apiurl}/fwschema`, { params: scopeParams });
            setRows((data ?? []).map((item) => ({
                ...item,
                hierarchy: [item.tableName, String(item.schemaID)],
                columnVisible: item.columnVisible === 0 ? 'No' : 'Yes',
                columnOptional: item.columnOptional === 0 ? 'No' : 'Yes',
            })));
        } catch (err) {
            console.error(err);
            notify("Failed to load schema. Check the browser log for details.", "error");
        } finally {
            setIsSchemaLoading(false);
        }
    }, [apiurl, notify, scopeParams]);

    useEffect(() => {
        fetchSchema();
    }, [fetchSchema]);

    const processRowUpdate = useCallback((newRow, oldRow) => new Promise((resolve) => {
        const field = Object.keys(EDITABLE_FIELDS).find((key) => newRow[key] !== oldRow[key]);
        if (!field) return resolve(oldRow);
        if (field === 'columnLabel' && !newRow.columnLabel.trim()) {
            notify('Column Label cannot be empty', 'error');
            return resolve(oldRow);
        }
        setPendingEdit({ newRow, oldRow, field, resolve });
    }), [notify]);

    const cancelEdit = () => {
        pendingEdit.resolve(pendingEdit.oldRow);
        setPendingEdit(null);
    };

    // Editing a DEFAULT row while scoped to a type/company clones the default schema for that
    // scope with the change applied (POST); otherwise the existing row is updated in place (PUT).
    const confirmEdit = async () => {
        const { newRow, oldRow, field, resolve } = pendingEdit;
        const change = { [field]: newRow[field] };
        try {
            if (selectedCompanyType && newRow.companyTypeOfBusiness === DEFAULT_SCOPE) {
                await axios.post(`${apiurl}/fwschema`, {
                    columnName: newRow.columnName,
                    schemaAddedBy: user.emp_id,
                    companyTypeOfBusiness: selectedCompanyType.feature_id,
                    ...change,
                });
            } else if (selectedCompany && newRow.companyID === DEFAULT_SCOPE) {
                await axios.post(`${apiurl}/fwschema`, {
                    columnName: newRow.columnName,
                    schemaAddedBy: user.emp_id,
                    companyID: selectedCompany.com_id,
                    companyTypeOfBusiness: selectedCompany.companyTypeOfBusiness,
                    companyState: selectedCompany.companyState,
                    ...change,
                });
            } else {
                await axios.put(`${apiurl}/fwschema`, { schemaID: newRow.schemaID, ...change });
            }
            notify('Details successfully saved', 'success');
            resolve(newRow);
            fetchSchema();
        } catch (err) {
            console.error(err);
            notify('Failed to save. Check the browser log for details.', 'error');
            resolve(oldRow);
        } finally {
            setPendingEdit(null);
        }
    };

    return (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '8px 8px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
                <Autocomplete
                    value={selectedCompanyType}
                    options={companyTypes}
                    loading={isDropdownLoading}
                    getOptionLabel={(option) => option.feature_value}
                    isOptionEqualToValue={(option, value) => option.feature_id === value.feature_id}
                    onChange={(e, value) => { setSelectedCompanyType(value); setSelectedCompany(null); }}
                    renderInput={(params) => <TextField {...params} label="Select Company Type" />}
                    sx={{ width: 250 }}
                    size="small"
                />
                <Typography sx={{ alignContent: 'center', mx: 5 }}>OR</Typography>
                <Autocomplete
                    value={selectedCompany}
                    options={companies}
                    loading={isDropdownLoading}
                    getOptionLabel={(option) => option.com_name}
                    isOptionEqualToValue={(option, value) => option.com_id === value.com_id}
                    onChange={(e, value) => { setSelectedCompany(value); setSelectedCompanyType(null); }}
                    renderInput={(params) => <TextField {...params} label="Select Company" />}
                    sx={{ width: 250 }}
                    size="small"
                />
            </div>

            {scopeParams && (
                <div style={{ flex: 1, minHeight: 0, marginTop: 8 }}>
                    <DataGridPro
                        density="compact"
                        rows={rows}
                        getRowId={(row) => row.schemaID}
                        columns={columns}
                        showToolbar components={{ Toolbar: GridToolbar }}
                        initialState={{ sorting: { sortModel: [{ field: "columnLabel", sort: "asc" }] } }}
                        treeData
                        getTreeDataPath={(row) => row.hierarchy}
                        groupingColDef={{ headerName: 'Table Name' }}
                        processRowUpdate={processRowUpdate}
                        experimentalFeatures={{ newEditingApi: true }}
                        disableSelectionOnClick
                        loading={isSchemaLoading}
                    />
                </div>
            )}

            <Dialog maxWidth="xs" open={!!pendingEdit}>
                <DialogTitle>Are you sure?</DialogTitle>
                <DialogContent dividers>
                    {pendingEdit && `Pressing 'Yes' will change ${EDITABLE_FIELDS[pendingEdit.field]} from '${pendingEdit.oldRow[pendingEdit.field]}' to '${pendingEdit.newRow[pendingEdit.field]}'.`}
                </DialogContent>
                <DialogActions>
                    <Button onClick={cancelEdit}>No</Button>
                    <Button onClick={confirmEdit}>Yes</Button>
                </DialogActions>
            </Dialog>
        </div>
    );
}
