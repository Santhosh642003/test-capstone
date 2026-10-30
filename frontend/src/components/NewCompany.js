import React, { useState } from "react";
import { Button, Container, Grid, Paper, TextField, Typography } from "@mui/material";
import axios from "axios";
import { useNotify } from "./Feedback";
import { ONBOARD_APIURL } from "../config";

// Field order and grid widths match the rendered form. Field names are the onboarding API's payload keys.
const FIELDS = [
  { name: "company_name", label: "Company Name", xs: 12, required: true },
  { name: "first_name", label: "First Name", xs: 6, required: true },
  { name: "last_name", label: "Last Name", xs: 6, required: true },
  { name: "employee_email", label: "Employee Email", xs: 12, required: true, type: "email" },
  { name: "address_line_1", label: "Address Line 1", xs: 12, required: true },
  { name: "address_line_2", label: "Address Line 2", xs: 12 },
  { name: "city", label: "City", xs: 5, required: true },
  { name: "state", label: "State", xs: 3, required: true },
  { name: "zip", label: "ZIP", xs: 4, required: true },
];

const EMPTY_FORM = Object.fromEntries(FIELDS.map(({ name }) => [name, ""]));

// `environment` is the { dev, test, prod } flag object from ToggleMIS.
const onboardUrl = (environment) =>
  ONBOARD_APIURL[Object.keys(ONBOARD_APIURL).find((key) => environment[key])] ?? ONBOARD_APIURL.dev;

export default function NewCompany({ environment }) {
  const notify = useNotify();
  const [form, setForm] = useState(EMPTY_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await axios.post(`${onboardUrl(environment)}/azureGraph`, form);
      setForm(EMPTY_FORM);
      notify("Company submitted successfully!", "success");
    } catch (err) {
      console.error("Error creating company:", err);
      notify("Error creating company. Check the browser log for details.", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Container maxWidth="sm" sx={{ mt: 5 }}>
      <Paper elevation={3} sx={{ p: 4 }}>
        <Typography variant="h5" gutterBottom>
          New Company Registration
        </Typography>
        <form onSubmit={handleSubmit} autoComplete="off">
          <Grid container spacing={2}>
            {FIELDS.map(({ name, label, xs, required, type }) => (
              <Grid item xs={xs} key={name}>
                <TextField
                  label={label}
                  name={name}
                  type={type}
                  value={form[name]}
                  onChange={handleChange}
                  required={required}
                  fullWidth
                />
              </Grid>
            ))}
            <Grid item xs={12}>
              <Button type="submit" variant="contained" fullWidth disabled={isSubmitting} sx={{ mt: 2 }}>
                Submit
              </Button>
            </Grid>
          </Grid>
        </form>
      </Paper>
    </Container>
  );
}
