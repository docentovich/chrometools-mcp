# TODO List

## High Priority

### DatePicker Models Implementation
**Status**: Architecture approved, implementation pending
**Details**: See `models/DATEPICKER_IMPLEMENTATION.md`

**Tasks**:
- [ ] Implement `MuiDatePickerModel` + `executeMuiDatePickerAction`
- [ ] Implement `AntDatePickerModel` + `executeAntDatePickerAction`
- [ ] Implement `ReactDatePickerModel` + `executeReactDatePickerAction`
- [ ] Update `models/index.js` to register new models
- [ ] Update `index.js` to register new action handlers
- [ ] Test on real Material UI / Ant Design / react-datepicker apps

**Priority**: Start with Material UI (most common in enterprise apps)

---

## Medium Priority

### Missing Action Handlers
- [ ] `executeScrollToAction` (referenced by DefaultModel but not implemented)
- [ ] Consider other missing handlers from models

### Documentation Updates
- [ ] Update README.md when DatePicker models are implemented
- [ ] Add DatePicker examples to README

---

## Low Priority / Future

### Additional UI Framework DatePickers
- [ ] Vuetify DatePicker
- [ ] PrimeReact DatePicker
- [ ] Chakra UI DatePicker
- [ ] Blueprint.js DatePicker

### Other Custom Component Models
- [ ] Rich Text Editor models (Quill, TinyMCE, CKEditor)
- [ ] Multi-select / Tag Input models
- [ ] File Upload with preview models
- [ ] Color Picker models (beyond basic input[type=color])

---

## Completed (This Session - 2026-02-15)

### Model System Implementation
- [x] Created `models/ElementModel.js` base class
- [x] Created `models/index.js` with 13 concrete models
- [x] Created `models/ModelRegistry.js` with Strategy Pattern
- [x] Integrated models into APOM tree builder

### executeModelAction Tool
- [x] Implemented executeModelAction with APOM ID support
- [x] Implemented executeModelAction with CSS selector support
- [x] Routing via ModelRegistry.getActionHandler()
- [x] Testing on React TodoMVC

### Action Handlers
- [x] Created `utils/actions/check-action.js` for checkboxes
- [x] Fixed executeCheckAction timeout issue
- [x] Tested check/uncheck/toggle actions

### Bug Fixes
- [x] Fixed checkboxes not appearing in APOM tree (opacity:0 issue)
- [x] Updated `isVisible()` to allow stylable inputs with opacity:0
- [x] Documented browser context caching issue

### Material UI DatePicker Detection
- [x] Updated `DatePickerModel.matches()` to detect MUI DatePicker
- [x] Detection now checks for MuiFormControl + input + calendar icon

---

## Architecture Decisions

### ✅ Approved: Separate Models for Each UI Framework
- **Rationale**: DatePickers are fundamentally different across frameworks
- **Benefits**: Clean architecture, easier to maintain, framework-specific actions
- **Implementation**: MuiDatePickerModel, AntDatePickerModel, ReactDatePickerModel
- **Details**: See `models/DATEPICKER_IMPLEMENTATION.md`

---

**Last Updated**: 2026-02-15
