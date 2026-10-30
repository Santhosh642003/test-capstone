import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { DataGridPro, GridToolbar } from '@mui/x-data-grid-pro';
import { useNotify } from './Feedback';

const BYTES_PER_MB = 1024 * 1024;

// Per-company record counts from GET /employees. Fields match the API response.
const columns = [
    { field: 'id', headerName: 'id', width: 170, hide: true },
    {
        field: 'com_name',
        headerName: 'Company',
        flex: 3,
        renderCell: (params) => (
            <p className="text-wrap" style={{ lineHeight: 1 }}>{params.value}</p>
        ),
    },
    { field: 'employees', headerName: 'Employees', flex: 1 },
    { field: 'projects', headerName: 'Projects', flex: 1 },
    { field: 'contacts', headerName: 'Contacts', flex: 1 },
    { field: 'customers', headerName: 'Customers', flex: 1 },
    { field: 'locations', headerName: 'Locations', flex: 1 },
    { field: 'artifacts', headerName: 'Artifacts', flex: 1 },
    { field: 'mts', headerName: 'MTs', flex: 1 },
    { field: 'claims', headerName: 'Claims', flex: 1 },
    {
        field: 'storage',
        headerName: 'Storage (MB)',
        flex: 1,
        valueFormatter: ({ value }) => (typeof value === 'number' ? value.toFixed(2) : '-'),
    },
];

export default function CompanySummary({ apiurl }) {
    const notify = useNotify();
    const [companies, setCompanies] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        setIsLoading(true);

        axios.get(`${apiurl}/employees`)
            .then(({ data }) => {
                if (!cancelled) setCompanies(data);
            })
            .catch((err) => {
                console.error(err);
                if (!cancelled) notify("Failed to load company summary. Check the browser log for details.", "error");
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false);
            });

        return () => { cancelled = true; };
    }, [apiurl, notify]);

    // storage comes back in bytes (or null when the usage table is unavailable)
    const rows = useMemo(
        () => companies.map((company, index) => ({
            ...company,
            id: index,
            storage: company.storage ? company.storage / BYTES_PER_MB : null,
        })),
        [companies]
    );

    return (
        <div style={{ flex: 1, minHeight: 0 }}>
            <DataGridPro
                density="compact"
                rows={rows}
                columns={columns}
                showToolbar components={{ Toolbar: GridToolbar }}
                pageSize={10}
                loading={isLoading}
            />
        </div>
    );
}
