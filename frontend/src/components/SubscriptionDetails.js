import React, { useEffect, useState } from "react";
import axios from "axios";
import moment from "moment";
import { DataGridPro, GridToolbar } from "@mui/x-data-grid-pro";
import { useNotify } from "./Feedback";

const DATE_FORMAT = "MM/DD/YYYY";
const TYPED_DATE_FORMATS = [DATE_FORMAT, "M/D/YYYY"];

// company.subscriptionPlan is stored as a number; the grid shows and edits the name.
// -1 marks internal test companies (created by dev/support); reporting queries exclude them.
const PLAN_NAMES = { "-1": "Test Company", 0: "N/A", 1: "Foundation", 2: "Growth", 3: "Business", 4: "Enterprise" };
const PLAN_IDS = Object.fromEntries(Object.entries(PLAN_NAMES).map(([id, name]) => [name, Number(id)]));
const toPlanId = (value) => (typeof value === "number" ? value : PLAN_IDS[value] ?? 0);

// Dates arrive from the API as ISO strings and are edited as MM/DD/YYYY text. Both are
// normalised to MM/DD/YYYY (what the PUT expects); blanks become "" (which the API stores as NULL).
// Anything unparseable becomes "Invalid date", which the API rejects with a message.
const normalizeDate = (value) => {
    if (!value) return "";
    const typed = moment(value, TYPED_DATE_FORMATS, true);
    if (typed.isValid()) return typed.format(DATE_FORMAT);
    const iso = moment(value, moment.ISO_8601, true);
    return iso.isValid() ? iso.utc().format(DATE_FORMAT) : "Invalid date";
};

const toDate = (value) => {
    const normalized = normalizeDate(value);
    return normalized && normalized !== "Invalid date" ? moment(normalized, DATE_FORMAT).toDate() : null;
};

const dateColumn = (field, headerName) => ({
    field,
    headerName,
    flex: 1,
    editable: true,
    valueGetter: ({ value }) => normalizeDate(value),
    sortComparator: (a, b) => (toDate(a)?.getTime() ?? 0) - (toDate(b)?.getTime() ?? 0),
});

const DATE_FIELDS = ["trialStartDate", "trialEndDate", "subscriptionStartDate", "subscriptionEndDate"];

const columns = [
    // The PUT identifies the company by name, so this column can't be editable.
    { field: "com_name", headerName: "Company", flex: 1.5 },
    dateColumn("trialStartDate", "Trial start date"),
    dateColumn("trialEndDate", "Trial End date"),
    dateColumn("subscriptionStartDate", "Subscription start date"),
    dateColumn("subscriptionEndDate", "Subscription End date"),
    {
        field: "subscriptionPlan",
        headerName: "Subscription Plan",
        flex: 1,
        editable: true,
        type: "singleSelect",
        valueOptions: Object.values(PLAN_NAMES),
        valueGetter: ({ value }) => PLAN_NAMES[toPlanId(value)],
    },
];

const isWithin = (start, end, now) => start && end && start <= now && end >= now;

// Tree-data group for a company: an active subscription wins over an active trial.
const subscriptionStatus = (row) => {
    const now = new Date();
    if (isWithin(toDate(row.subscriptionStartDate), toDate(row.subscriptionEndDate), now)) return "Active Subscriptions";
    if (isWithin(toDate(row.trialStartDate), toDate(row.trialEndDate), now)) return "In Trial";
    return "Expired Subscriptions";
};

export default function SubscriptionDetails({ apiurl }) {
    const notify = useNotify();
    const [companies, setCompanies] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        setIsLoading(true);

        axios.get(`${apiurl}/company/AllDetails`)
            .then(({ data }) => {
                if (!cancelled) setCompanies(data.company ?? []);
            })
            .catch((err) => {
                console.error(err);
                if (!cancelled) notify("Failed to load subscription details. Check the browser log for details.", "error");
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false);
            });

        return () => { cancelled = true; };
    }, [apiurl, notify]);

    const processRowUpdate = async (newRow, oldRow) => {
        const updated = {
            ...newRow,
            ...Object.fromEntries(DATE_FIELDS.map((field) => [field, normalizeDate(newRow[field])])),
            subscriptionPlan: toPlanId(newRow.subscriptionPlan),
        };

        try {
            const { data } = await axios.put(`${apiurl}/company/AllDetails`, {
                company: updated.com_name,
                ...Object.fromEntries(DATE_FIELDS.map((field) => [field, updated[field]])),
                subscriptionPlan: updated.subscriptionPlan,
            });
            // The API answers HTTP 200 with { code: 500, message } on validation failure.
            if (data?.code === 500) throw new Error(data.message);
            notify("Subscription details updated", "success");
            return updated;
        } catch (err) {
            console.error(err);
            notify(err.message || "Failed to update subscription details", "error");
            return oldRow;
        }
    };

    return (
        <div style={{ flex: 1, minHeight: 0 }}>
            <DataGridPro
                density="compact"
                rows={companies}
                getRowId={(row) => row.com_id}
                columns={columns}
                showToolbar
                components={{ Toolbar: GridToolbar }}
                treeData
                getTreeDataPath={(row) => [subscriptionStatus(row), String(row.com_id)]}
                groupingColDef={{ headerName: "Subscription Status", flex: 1.5 }}
                initialState={{ sorting: { sortModel: [{ field: "com_name", sort: "asc" }] } }}
                processRowUpdate={processRowUpdate}
                experimentalFeatures={{ newEditingApi: true }}
                loading={isLoading}
            />
        </div>
    );
}
