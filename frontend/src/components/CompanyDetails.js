import React, { useEffect, useState } from "react";
import axios from "axios";
import moment from "moment-timezone";
import { DataGridPro, GridToolbar } from "@mui/x-data-grid-pro";
import { useNotify } from './Feedback';

const formatDateTime = (value) =>
    moment(value).isValid() ? moment(value).tz("America/New_York").format("MM/DD/YYYY HH:mm:ss") : "";

const joinParts = (...parts) => parts.filter(Boolean).join(" ");

// One row per employee, with company and most recent login, from GET /company?employeeLog=true.
const columns = [
    { field: 'com_id', headerName: 'Company ID', flex: 1 },
    { field: 'com_name', headerName: 'Company', flex: 2 },
    { field: 'emp_first_name', headerName: 'Employee First Name', flex: 2, hide: true },
    { field: 'emp_last_name', headerName: 'Employee Last Name', flex: 2, hide: true },
    {
        field: 'fullName',
        headerName: 'Employee Name',
        flex: 2,
        valueGetter: ({ row }) => joinParts(row.emp_first_name, row.emp_last_name),
    },
    { field: 'emp_id', headerName: 'Employee ID', flex: 2, hide: true },
    {
        field: 'emp_created_at',
        headerName: 'Date added',
        flex: 2,
        valueFormatter: ({ value }) => formatDateTime(value),
    },
    {
        field: 'recent_log_in',
        headerName: 'Last Login',
        flex: 2,
        valueFormatter: ({ value }) => formatDateTime(value),
    },
    { field: 'empEmail', headerName: 'Employee Email', flex: 3 },
    {
        field: 'address',
        headerName: 'Address',
        flex: 4,
        valueGetter: ({ row }) =>
            joinParts(row.emp_addr_line1, row.emp_addr_line2, row.emp_city, row.emp_state, row.emp_zip),
    },
];

export default function CompanyDetails({ apiurl }) {
    const notify = useNotify();
    const [employees, setEmployees] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        setIsLoading(true);

        axios.get(`${apiurl}/company`, { params: { employeeLog: true } })
            .then(({ data }) => {
                if (!cancelled) setEmployees(data.company ?? []);
            })
            .catch((err) => {
                console.error(err);
                if (!cancelled) notify("Failed to load company details. Check the browser log for details.", "error");
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false);
            });

        return () => { cancelled = true; };
    }, [apiurl, notify]);

    return (
        <div style={{ flex: 1, minHeight: 0 }}>
            <DataGridPro
                density="compact"
                rows={employees}
                getRowId={(row) => row.emp_id}
                columns={columns}
                showToolbar components={{ Toolbar: GridToolbar }}
                initialState={{
                    sorting: { sortModel: [{ field: "recent_log_in", sort: "desc" }] },
                }}
                loading={isLoading}
            />
        </div>
    );
}
