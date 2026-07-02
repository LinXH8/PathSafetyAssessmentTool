# Platform Compatibility Guide

## Overview

This application has been designed to run on multiple platforms (Windows, macOS, Linux). However, some features require Windows-specific dependencies.

## Platform-Specific Features

### Windows-Only Features

The following features require **Windows** and the **pywin32** package:

1. **CycleRAP Score Calculation** (`calculate_cycleRAP_score`)
   - Requires Excel COM automation to interact with the CycleRAP Excel workbook
   - Uses `pythoncom` and `win32com.client` from the `pywin32` package

2. **Treatment Evaluation** (`evaluate_treatment_suggestions`)
   - Requires Excel COM automation to process treatment data
   - Uses `pythoncom` and `win32com.client` from the `pywin32` package

### Cross-Platform Features

The following features work on all platforms:

- Project management and data serialization
- Geographic data processing
- Data loading and caching
- API integrations
- All non-Excel related functionality

## Installation

### On Windows

Install all dependencies including pywin32:

```bash
pip install -r requirements.txt
```

The `pywin32` package will be automatically installed on Windows systems.

### On macOS/Linux

Install dependencies (pywin32 will be automatically skipped):

```bash
pip install -r requirements.txt
```

Note: Windows-only features will not be available, but the application will run normally.

## Error Handling

If you attempt to use Windows-only features on a non-Windows platform, you will receive a clear error message:

```
RuntimeError: [Feature Name] requires Windows. Current platform: Darwin
```

If you're on Windows but pywin32 is not installed:

```
RuntimeError: [Feature Name] requires pywin32 package. Please install it with: pip install pywin32
```

## Implementation Details

Platform detection is handled by the `app.services.platform_compat` module, which:

1. Detects the current platform using `platform.system()`
2. Conditionally imports Windows-specific modules
3. Provides helper functions to check feature availability
4. Raises informative errors when features are unavailable

## For Developers

When adding new Windows-specific functionality:

1. Import from `platform_compat` instead of direct imports:
   ```python
   from app.services.platform_compat import get_pythoncom, get_excel_client, check_windows_feature
   ```

2. Add a platform check at the beginning of the function:
   ```python
   check_windows_feature("Your Feature Name")
   pythoncom = get_pythoncom()
   win32 = get_excel_client()
   ```

3. Document that the feature requires Windows in the docstring

## Testing

The application has been tested on:
- ✅ macOS (Darwin) - Core features working
- ✅ Windows - All features available with pywin32

## Future Improvements

Consider implementing cross-platform alternatives for Excel-dependent features:
- Use `openpyxl` or `xlrd/xlsxwriter` for basic Excel operations
- Implement server-side calculation logic to replace VBA macros
- Provide Docker containers with Windows environments for cloud deployments
