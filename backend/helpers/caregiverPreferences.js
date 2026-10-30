const db = require('../models/indexSQL.js');
const { parseSQLText } = require('../utils/validation.js');

// GET caregiver preferences for an employee
exports.getCaregiverPreferences = async (req, res) => {
    try {
        const { employee_id } = req.query;
        if (!employee_id) {
            return res.status(400).json({ message: 'employee_id is required' });
        }

        const result = await db.query(`
            SELECT * FROM caregiver_preferences WHERE employee_id = ${parseInt(employee_id)}
        `);

        if (result.recordset.length === 0) {
            return res.json(null);
        }

        const row = result.recordset[0];

        // Parse JSON fields
        const preferences = {
            ...row,
            preferred_hours: row.preferred_hours ? JSON.parse(row.preferred_hours) : [],
            skills: row.skills ? JSON.parse(row.skills) : [],
            additional_preferences: row.additional_preferences ? JSON.parse(row.additional_preferences) : [],
        };

        res.json(preferences);
    } catch (error) {
        console.error('Error fetching caregiver preferences:', error);
        res.status(500).json({ message: 'Error fetching caregiver preferences' });
    }
};

// CREATE or UPDATE caregiver preferences (upsert)
exports.upsertCaregiverPreferences = async (req, res) => {
    try {
        const {
            employee_id,
            driving_distance_km,
            preferred_hours,
            skills,
            overtime_acceptable,
            additional_preferences,
        } = req.body;

        if (!employee_id) {
            return res.status(400).json({ message: 'employee_id is required' });
        }

        const empId = parseInt(employee_id);
        if (isNaN(empId)) {
            return res.status(400).json({ message: 'employee_id must be a valid number' });
        }

        // Validate driving_distance_km
        const distance = driving_distance_km !== null && driving_distance_km !== undefined && driving_distance_km !== ''
            ? parseFloat(driving_distance_km)
            : null;
        if (distance !== null && (isNaN(distance) || distance < 0)) {
            return res.status(400).json({ message: 'driving_distance_km must be a positive number' });
        }

        // Serialize JSON fields
        const hoursJSON = preferred_hours ? `'${parseSQLText(JSON.stringify(preferred_hours), 4000)}'` : 'NULL';
        const skillsJSON = skills ? `'${parseSQLText(JSON.stringify(skills), 4000)}'` : 'NULL';
        const prefsJSON = additional_preferences ? `'${parseSQLText(JSON.stringify(additional_preferences), 4000)}'` : 'NULL';
        const overtimeVal = overtime_acceptable === true || overtime_acceptable === 1 ? 1 : 0;
        const distanceVal = distance !== null ? distance : 'NULL';

        // Check if record exists
        const existing = await db.query(`
            SELECT id FROM caregiver_preferences WHERE employee_id = ${empId}
        `);

        if (existing.recordset.length > 0) {
            // UPDATE
            await db.query(`
                UPDATE caregiver_preferences SET
                    driving_distance_km = ${distanceVal},
                    preferred_hours = ${hoursJSON},
                    skills = ${skillsJSON},
                    overtime_acceptable = ${overtimeVal},
                    additional_preferences = ${prefsJSON},
                    updated_at = GETDATE()
                WHERE employee_id = ${empId}
            `);
            res.json({ message: 'Caregiver preferences updated successfully' });
        } else {
            // INSERT
            await db.query(`
                INSERT INTO caregiver_preferences (
                    employee_id, driving_distance_km, preferred_hours,
                    skills, overtime_acceptable, additional_preferences,
                    created_at, updated_at
                ) VALUES (
                    ${empId}, ${distanceVal}, ${hoursJSON},
                    ${skillsJSON}, ${overtimeVal}, ${prefsJSON},
                    GETDATE(), GETDATE()
                )
            `);
            res.json({ message: 'Caregiver preferences created successfully' });
        }
    } catch (error) {
        console.error('Error saving caregiver preferences:', error);
        res.status(500).json({ message: 'Error saving caregiver preferences' });
    }
};

// GET all caregiver preferences for a company (for matchmaking)
exports.getCompanyCaregiverPreferences = async (req, res) => {
    try {
        const { com_id } = req.query;
        if (!com_id) {
            return res.status(400).json({ message: 'com_id is required' });
        }

        const result = await db.query(`
            SELECT cp.*, e.emp_first_name, e.emp_last_name, e.empEmail,
                   e.emp_addr_line1, e.emp_addr_line2, e.emp_city, e.emp_state, e.emp_zip
            FROM caregiver_preferences cp
            INNER JOIN employee e ON cp.employee_id = e.emp_id
            WHERE e.emp_company_id = ${parseInt(com_id)} AND e.emp_is_active = 1
        `);

        const preferences = result.recordset.map(row => ({
            ...row,
            preferred_hours: row.preferred_hours ? JSON.parse(row.preferred_hours) : [],
            skills: row.skills ? JSON.parse(row.skills) : [],
            additional_preferences: row.additional_preferences ? JSON.parse(row.additional_preferences) : [],
        }));

        res.json(preferences);
    } catch (error) {
        console.error('Error fetching company caregiver preferences:', error);
        res.status(500).json({ message: 'Error fetching company caregiver preferences' });
    }
};

// ─── Master Skills CRUD ───────────────────────────────────────────

// GET active master skills for a company
exports.getMasterSkills = async (req, res) => {
    try {
        const { com_id } = req.query;
        if (!com_id) {
            return res.status(400).json({ message: 'com_id is required' });
        }

        const result = await db.query(`
            SELECT id, skill_name FROM caregiver_master_skills
            WHERE com_id = ${parseInt(com_id)} AND is_active = 1
            ORDER BY skill_name
        `);

        res.json(result.recordset);
    } catch (error) {
        console.error('Error fetching master skills:', error);
        res.status(500).json({ message: 'Error fetching master skills' });
    }
};

// ADD a master skill for a company
exports.addMasterSkill = async (req, res) => {
    try {
        const { com_id, skill_name } = req.body;
        if (!com_id || !skill_name) {
            return res.status(400).json({ message: 'com_id and skill_name are required' });
        }

        const sanitized = parseSQLText(skill_name.trim(), 255);

        // Re-activate if it was soft-deleted, otherwise insert
        const existing = await db.query(`
            SELECT id, is_active FROM caregiver_master_skills
            WHERE com_id = ${parseInt(com_id)} AND skill_name = '${sanitized}'
        `);

        if (existing.recordset.length > 0) {
            if (existing.recordset[0].is_active === false) {
                await db.query(`
                    UPDATE caregiver_master_skills SET is_active = 1
                    WHERE id = ${existing.recordset[0].id}
                `);
                return res.json({ id: existing.recordset[0].id, skill_name: skill_name.trim(), message: 'Skill reactivated' });
            }
            return res.status(409).json({ message: 'Skill already exists' });
        }

        const insertResult = await db.query(`
            INSERT INTO caregiver_master_skills (com_id, skill_name)
            OUTPUT INSERTED.id
            VALUES (${parseInt(com_id)}, '${sanitized}')
        `);

        res.json({ id: insertResult.recordset[0].id, skill_name: skill_name.trim(), message: 'Skill added' });
    } catch (error) {
        console.error('Error adding master skill:', error);
        res.status(500).json({ message: 'Error adding master skill' });
    }
};

// REMOVE (soft-delete) a master skill
exports.removeMasterSkill = async (req, res) => {
    try {
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ message: 'id is required' });
        }

        await db.query(`
            UPDATE caregiver_master_skills SET is_active = 0 WHERE id = ${parseInt(id)}
        `);

        res.json({ message: 'Skill removed' });
    } catch (error) {
        console.error('Error removing master skill:', error);
        res.status(500).json({ message: 'Error removing master skill' });
    }
};

// ─── Master Preferences CRUD ─────────────────────────────────────

// GET active master preferences for a company
exports.getMasterPreferences = async (req, res) => {
    try {
        const { com_id } = req.query;
        if (!com_id) {
            return res.status(400).json({ message: 'com_id is required' });
        }

        const result = await db.query(`
            SELECT id, preference_name FROM caregiver_master_preferences
            WHERE com_id = ${parseInt(com_id)} AND is_active = 1
            ORDER BY preference_name
        `);

        res.json(result.recordset);
    } catch (error) {
        console.error('Error fetching master preferences:', error);
        res.status(500).json({ message: 'Error fetching master preferences' });
    }
};

// ADD a master preference for a company
exports.addMasterPreference = async (req, res) => {
    try {
        const { com_id, preference_name } = req.body;
        if (!com_id || !preference_name) {
            return res.status(400).json({ message: 'com_id and preference_name are required' });
        }

        const sanitized = parseSQLText(preference_name.trim(), 255);

        // Re-activate if it was soft-deleted, otherwise insert
        const existing = await db.query(`
            SELECT id, is_active FROM caregiver_master_preferences
            WHERE com_id = ${parseInt(com_id)} AND preference_name = '${sanitized}'
        `);

        if (existing.recordset.length > 0) {
            if (existing.recordset[0].is_active === false) {
                await db.query(`
                    UPDATE caregiver_master_preferences SET is_active = 1
                    WHERE id = ${existing.recordset[0].id}
                `);
                return res.json({ id: existing.recordset[0].id, preference_name: preference_name.trim(), message: 'Preference reactivated' });
            }
            return res.status(409).json({ message: 'Preference already exists' });
        }

        const insertResult = await db.query(`
            INSERT INTO caregiver_master_preferences (com_id, preference_name)
            OUTPUT INSERTED.id
            VALUES (${parseInt(com_id)}, '${sanitized}')
        `);

        res.json({ id: insertResult.recordset[0].id, preference_name: preference_name.trim(), message: 'Preference added' });
    } catch (error) {
        console.error('Error adding master preference:', error);
        res.status(500).json({ message: 'Error adding master preference' });
    }
};

// REMOVE (soft-delete) a master preference
exports.removeMasterPreference = async (req, res) => {
    try {
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ message: 'id is required' });
        }

        await db.query(`
            UPDATE caregiver_master_preferences SET is_active = 0 WHERE id = ${parseInt(id)}
        `);

        res.json({ message: 'Preference removed' });
    } catch (error) {
        console.error('Error removing master preference:', error);
        res.status(500).json({ message: 'Error removing master preference' });
    }
};

// ─── Employee Matchmaking / Suggestion ───────────────────────────

exports.matchEmployees = async (req, res) => {
    try {
        const {
            com_id,
            shift_date,       // e.g. '2025-07-15' — used to derive day of week
            start_time,       // e.g. '08:00'
            end_time,         // e.g. '17:00'
            required_skills,  // string[]
            required_preferences, // string[]
            location_zip,     // from the selected resource's joined location
            location_city,    // from the selected resource's joined location
            location_state,   // from the selected resource's joined location
        } = req.body;

        if (!com_id) {
            return res.status(400).json({ message: 'com_id is required' });
        }

        // 1. Fetch all active employees for the company (with caregiver prefs if set)
        const result = await db.query(`
            SELECT e.emp_id, e.emp_first_name, e.emp_last_name,
                   e.emp_addr_line1, e.emp_addr_line2, e.emp_city, e.emp_state, e.emp_zip,
                   cp.driving_distance_km, cp.preferred_hours, cp.skills,
                   cp.overtime_acceptable, cp.additional_preferences
            FROM employee e
            LEFT JOIN caregiver_preferences cp ON e.emp_id = cp.employee_id
            WHERE e.emp_company_id = ${parseInt(com_id)} AND e.emp_is_active = 1
        `);

        const employees = result.recordset;

        // Derive day-of-week from shift_date
        const shiftDayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const shiftDay = shift_date ? shiftDayNames[new Date(shift_date + 'T12:00:00').getDay()] : null;

        // Parse shift times to minutes for easy comparison
        const parseTime = (t) => {
            if (!t) return null;
            const [h, m] = t.split(':').map(Number);
            return h * 60 + (m || 0);
        };
        const shiftStart = parseTime(start_time);
        const shiftEnd = parseTime(end_time);

        // ── Address-based proximity scoring ──────────────────────
        // Returns a proximity tier: 1.0 = same zip, 0.75 = same city+state,
        // 0.4 = same zip region (first 3 digits), 0.2 = same state, 0 = different
        const norm = (s) => (s || '').trim().toLowerCase();
        const locZip = norm(location_zip);
        const locCity = norm(location_city);
        const locState = norm(location_state);
        const hasLocation = locZip || locCity;

        const proximityScore = (empZip, empCity, empState) => {
            const ez = norm(empZip);
            const ec = norm(empCity);
            const es = norm(empState);
            if (!ez && !ec) return null; // no employee address on file
            if (locZip && ez && locZip === ez) return 1.0;         // same zip
            if (locCity && ec && locCity === ec && locState && es && locState === es) return 0.75; // same city+state
            if (locZip && ez && locZip.substring(0, 3) === ez.substring(0, 3)) return 0.4;  // same zip region
            if (locState && es && locState === es) return 0.2;     // same state
            return 0; // different state / region
        };

        // Estimated distances for each tier (km) used to compare with driving_distance_km pref
        const tierEstimateKm = { 1.0: 5, 0.75: 15, 0.4: 50, 0.2: 120, 0: 300 };

        const reqSkills = Array.isArray(required_skills) ? required_skills.map(s => s.toLowerCase().trim()) : [];
        const reqPrefs = Array.isArray(required_preferences) ? required_preferences.map(p => p.toLowerCase().trim()) : [];

        const scored = employees.map(emp => {
            const hasPrefs = emp.skills !== null || emp.preferred_hours !== null || emp.additional_preferences !== null;

            // Parse JSON fields
            const empSkills = emp.skills ? JSON.parse(emp.skills).map(s => s.toLowerCase().trim()) : [];
            const empPrefs = emp.additional_preferences ? JSON.parse(emp.additional_preferences).map(p => p.toLowerCase().trim()) : [];
            const empHours = emp.preferred_hours ? JSON.parse(emp.preferred_hours) : [];

            // ── Scoring ─────────────────────────────────
            let score = 0;
            let maxScore = 0;
            const breakdown = { skills: null, preferences: null, hours: null, distance: null };

            // Skills matching (each required skill = 1 point)
            if (reqSkills.length > 0) {
                maxScore += reqSkills.length;
                if (empSkills.length > 0) {
                    const matched = reqSkills.filter(s => empSkills.includes(s));
                    score += matched.length;
                    breakdown.skills = { matched: matched.length, total: reqSkills.length, status: matched.length === reqSkills.length ? 'full' : matched.length > 0 ? 'partial' : 'none' };
                } else if (!hasPrefs) {
                    // No prefs set at all — neutral match (half credit)
                    score += reqSkills.length * 0.5;
                    breakdown.skills = { matched: reqSkills.length, total: reqSkills.length, status: 'neutral' };
                } else {
                    // Has prefs but no skills listed — doesn't match
                    breakdown.skills = { matched: 0, total: reqSkills.length, status: 'none' };
                }
            }

            // Additional preferences matching (each = 1 point)
            if (reqPrefs.length > 0) {
                maxScore += reqPrefs.length;
                if (empPrefs.length > 0) {
                    const matched = reqPrefs.filter(p => empPrefs.includes(p));
                    score += matched.length;
                    breakdown.preferences = { matched: matched.length, total: reqPrefs.length, status: matched.length === reqPrefs.length ? 'full' : matched.length > 0 ? 'partial' : 'none' };
                } else if (!hasPrefs) {
                    score += reqPrefs.length * 0.5;
                    breakdown.preferences = { matched: reqPrefs.length, total: reqPrefs.length, status: 'neutral' };
                } else {
                    breakdown.preferences = { matched: 0, total: reqPrefs.length, status: 'none' };
                }
            }

            // Preferred hours / day matching (1 point)
            if (shiftDay && shiftStart !== null && shiftEnd !== null) {
                maxScore += 1;
                if (empHours.length > 0) {
                    const daySlots = empHours.filter(h => h.day === shiftDay);
                    if (daySlots.length > 0) {
                        const fits = daySlots.some(slot => {
                            const slotStart = parseTime(slot.startTime);
                            const slotEnd = parseTime(slot.endTime);
                            return slotStart <= shiftStart && slotEnd >= shiftEnd;
                        });
                        score += fits ? 1 : 0;
                        breakdown.hours = { status: fits ? 'full' : 'none' };
                    } else {
                        // Employee has hours set but not for this day
                        breakdown.hours = { status: 'none' };
                    }
                } else if (!hasPrefs) {
                    score += 0.5;
                    breakdown.hours = { status: 'neutral' };
                } else {
                    // Has prefs but no hours set — treat as flexible (neutral)
                    score += 0.5;
                    breakdown.hours = { status: 'neutral' };
                }
            }

            // Distance matching (1 point) — uses employee address vs shift location address
            if (hasLocation) {
                maxScore += 1;
                const prox = proximityScore(emp.emp_zip, emp.emp_city, emp.emp_state);

                if (prox === null) {
                    // Employee has no address on file — neutral
                    score += 0.5;
                    breakdown.distance = { status: 'neutral', reason: 'No address on file' };
                } else if (emp.driving_distance_km) {
                    // Compare estimated distance against employee's preferred max distance
                    const estimatedKm = tierEstimateKm[prox] ?? 300;
                    const withinPref = estimatedKm <= emp.driving_distance_km;
                    if (prox >= 0.75 && withinPref) {
                        score += 1;
                        breakdown.distance = { status: 'full', estimatedKm, maxKm: emp.driving_distance_km };
                    } else if (withinPref) {
                        score += 0.75;
                        breakdown.distance = { status: 'partial', estimatedKm, maxKm: emp.driving_distance_km };
                    } else {
                        score += 0;
                        breakdown.distance = { status: 'none', estimatedKm, maxKm: emp.driving_distance_km };
                    }
                } else {
                    // No distance pref set — score based on raw proximity
                    score += prox;
                    const pStatus = prox >= 0.75 ? 'full' : prox >= 0.4 ? 'partial' : prox > 0 ? 'partial' : 'none';
                    breakdown.distance = { status: pStatus, estimatedKm: tierEstimateKm[prox] ?? 300 };
                }
            }

            const matchPercent = maxScore > 0 ? Math.round((score / maxScore) * 100) : (hasPrefs ? 50 : 50);

            return {
                employee_id: emp.emp_id,
                employee_name: `${emp.emp_first_name} ${emp.emp_last_name}`,
                hasPreferences: hasPrefs,
                score,
                maxScore,
                matchPercent,
                breakdown,
            };
        });

        // Sort: highest match % first, then explicit matchers before neutral ones
        scored.sort((a, b) => {
            if (b.matchPercent !== a.matchPercent) return b.matchPercent - a.matchPercent;
            // Prefer employees who have set preferences (explicit match) over those who haven't
            if (a.hasPreferences !== b.hasPreferences) return a.hasPreferences ? -1 : 1;
            return a.employee_name.localeCompare(b.employee_name);
        });

        res.json(scored);
    } catch (error) {
        console.error('Error in employee matchmaking:', error);
        res.status(500).json({ message: 'Error performing employee matchmaking' });
    }
};
