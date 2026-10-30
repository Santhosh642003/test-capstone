import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { Box, Button, Container, FormControl, InputLabel, MenuItem, Select, TextField, Typography } from "@mui/material";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import MUIRichTextEditor from "mui-rte";
import { ContentState, convertToRaw } from "draft-js";
import { useNotify } from "./Feedback";

// mui-rte reads its styling from the MUI v4-style `overrides` slot on the theme.
const editorTheme = createTheme({
  overrides: {
    MUIRichTextEditor: {
      container: { paddingLeft: 5 },
      editor: {
        backgroundColor: "white",
        padding: "20px",
        height: "200px",
        maxHeight: "200px",
        overflow: "auto",
        borderBottom: "1px solid lightblue",
        borderLeft: "1px solid lightblue",
        borderRight: "1px solid lightblue",
      },
      toolbar: { border: "1px solid gray", backgroundColor: "#ebebeb" },
      placeHolder: {
        color: "gray",
        borderTop: "1px solid lightblue",
        borderLeft: "1px solid lightblue",
        borderRight: "1px solid lightblue",
        padding: 20,
      },
      anchorLink: { color: "lightblue", textDecoration: "underline" },
    },
  },
});

const toRawJson = (text) => JSON.stringify(convertToRaw(ContentState.createFromText(text)));
const EMPTY_DESCRIPTION = toRawJson("");

// Descriptions are stored as Draft.js raw JSON, but older rows hold plain text and some
// were saved with escaped quotes. Normalise all of them to raw JSON the editor can load.
const toEditorContent = (stored) => {
  const unescaped = (stored ?? "").replace(/\\"/g, '"');
  try {
    JSON.parse(unescaped);
    return unescaped;
  } catch {
    return toRawJson(unescaped.replace(/[\n\t]/g, " "));
  }
};

const EMPTY_FORM = { Title: "", Description: EMPTY_DESCRIPTION, Version: "", DeploymentDate: "" };

export default function WhatsNew({ apiurl }) {
  const notify = useNotify();
  const [entries, setEntries] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  // Content the editor was last loaded with; bumping `editorKey` remounts it on reset.
  const [initialDescription, setInitialDescription] = useState(EMPTY_DESCRIPTION);
  const [editorKey, setEditorKey] = useState(0);
  const [isSaving, setIsSaving] = useState(false);

  const fetchEntries = useCallback(async () => {
    try {
      const { data } = await axios.get(`${apiurl}/whatsnew`);
      setEntries(data ?? []);
    } catch (err) {
      console.error(err);
      notify("Failed to load release notes. Check the browser log for details.", "error");
    }
  }, [apiurl, notify]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const loadEditor = (description) => {
    setInitialDescription(description);
    setEditorKey((k) => k + 1);
  };

  const selectEntry = (id) => {
    setSelectedId(id);
    const entry = entries.find((e) => e.ID === id);
    if (!entry) {
      setForm(EMPTY_FORM);
      loadEditor(EMPTY_DESCRIPTION);
      return;
    }
    const description = toEditorContent(entry.Description);
    setForm({
      Title: entry.Title ?? "",
      Description: description,
      Version: entry.Version ?? "",
      DeploymentDate: entry.DeploymentDate?.split("T")[0] ?? "",
    });
    loadEditor(description);
  };

  const setField = (name) => (value) => setForm((prev) => ({ ...prev, [name]: value }));

  const handleVersionChange = (e) => {
    if (/^[0-9.]*$/.test(e.target.value)) setField("Version")(e.target.value);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      if (selectedId) {
        await axios.put(`${apiurl}/whatsnew`, { ...form, ID: selectedId });
      } else {
        await axios.post(`${apiurl}/whatsnew`, form);
      }
      notify("Entry saved successfully!", "success");
      selectEntry("");
      fetchEntries();
    } catch (err) {
      console.error(err);
      notify("Failed to save entry. Check the browser log for details.", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const canSave = form.Title.trim() !== "" && form.DeploymentDate !== "";

  return (
    <div style={{ flex: 1, overflow: "auto", paddingBottom: 24 }}>
      <ThemeProvider theme={editorTheme}>
        <Container>
          <Typography variant="h5">What's New Release Notes Editor</Typography>

          <FormControl fullWidth margin="normal">
            <InputLabel id="select-entry-label">Select Entry</InputLabel>
            <Select
              labelId="select-entry-label"
              label="Select Entry"
              value={selectedId}
              onChange={(e) => selectEntry(e.target.value)}
            >
              <MenuItem value=""><em>New entry</em></MenuItem>
              {entries.map((entry) => (
                <MenuItem key={entry.ID} value={entry.ID}>{entry.Title}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <TextField
            fullWidth
            margin="normal"
            label="Title"
            required
            value={form.Title}
            onChange={(e) => setField("Title")(e.target.value)}
          />

          <Box sx={{ "& .public-DraftEditor-content": { textAlign: "left" } }}>
            <MUIRichTextEditor
              key={editorKey}
              label="Click here to start typing description..."
              defaultValue={initialDescription}
              editorStyle={{ minHeight: 200 }}
              onChange={(state) => setField("Description")(JSON.stringify(convertToRaw(state.getCurrentContent())))}
            />
          </Box>

          <TextField
            fullWidth
            margin="normal"
            label="Version Number, such as 1.0.1 (Leave blank if unsure)"
            value={form.Version}
            onChange={handleVersionChange}
          />
          <TextField
            fullWidth
            margin="normal"
            label="Deployment Date"
            type="date"
            required
            value={form.DeploymentDate}
            onChange={(e) => setField("DeploymentDate")(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />

          <Button variant="contained" onClick={handleSave} disabled={!canSave || isSaving}>
            {selectedId ? "Update" : "Save"}
          </Button>
        </Container>
      </ThemeProvider>
    </div>
  );
}
