# Interface with the CycleRAP excel sheet
from __future__ import annotations
import re
import json
import shutil
import datetime
# import pythoncom  # Windows-only, imported conditionally via platform_compat
import app.services.global_var as global_var
import pandas as pd
# import win32com.client as win32  # Windows-only, imported conditionally via platform_compat
from pathlib import Path
from openpyxl import load_workbook
import geopandas as gpd
from app.services.serializer import ProjectGeoData, Treatment, Attributes
from app.services.platform_compat import get_pythoncom, get_excel_client, check_windows_feature

ATTRIBUTE_STARTING_INDEX = 12
CYCLERAP_SOURCE = "CycleRAP_v2.11.xlsm"
DEFAULT_VALUES_SOURCE = "defaults.json"

class cycleRAP_interface:
    source_dir : Path = None
    attribute_default_values : dict[str, int | None] = None
    treatment_solutions : pd.DataFrame = None

    def __init__(self):
        raise RuntimeError("Cannot create class instance, use the class methods instead")

    @classmethod
    def initialise(cls, source_dir : Path):
        cls.source_dir : Path = source_dir

        cls.attribute_default_values : dict[str, int | None] = None
        cls.treatment_solutions : pd.DataFrame = None

        path = cls.source_dir / DEFAULT_VALUES_SOURCE
        if not path.exists():
            cls._write_default_config(path)
        cls._parse(path)

    @classmethod
    def _parse(cls, path : Path):
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)

        cls.attribute_default_values = data["attribute_default"]
        cls.treatment_solutions = pd.DataFrame(data["treatment_remedy"])

    @classmethod
    def get_cycleRAP_metadata(cls):
        # Read the specified sheet
        df = pd.read_excel(cls.source_dir / CYCLERAP_SOURCE, sheet_name="Upload_data")
        return df.iloc[:, :ATTRIBUTE_STARTING_INDEX]

    # Interface to calculate cycleRAP score, backend integration can be done here to replace the testbed
    @classmethod
    def calculate_cycleRAP_score(cls, attributes_df: pd.DataFrame) -> pd.DataFrame:
        """
        Write `attributes_df` to the 'Upload_data' sheet of the CycleRAP workbook,
        invoke the CalculateResults macro, then return the 'Risk Results' sheet
        as a pandas DataFrame.

        Note: This method requires Windows and the pywin32 package for Excel COM automation.
        """
        # Platform check: Ensure we're on Windows with pywin32 installed
        # This will raise RuntimeError if not available
        check_windows_feature("CycleRAP score calculation (Excel automation)")

        # Get Windows-specific modules dynamically
        pythoncom = get_pythoncom()
        win32 = get_excel_client()

        file_path = Path(cls.source_dir) / CYCLERAP_SOURCE
        pythoncom.CoInitialize()
        try:
            # 1) Launch Excel COM
            excel = win32.Dispatch('Excel.Application')
            excel.Visible = False
            excel.DisplayAlerts = False

            # 2) Open workbook
            wb = excel.Workbooks.Open(str(file_path))

            # 3) Get the target sheet and clear old contents
            ws = wb.Worksheets("Upload_data")
            # determine how many rows & columns are in use
            used = ws.UsedRange
            last_row = used.Row + used.Rows.Count - 1   # usually Row is 1 anyway
            last_col = used.Column + used.Columns.Count - 1

            # only clear rows 2 through last_row
            if last_row >= 2:
                ws.Range(
                    ws.Cells(2, 1),
                    ws.Cells(last_row, last_col)
                ).ClearContents()

            # 5) Write data rows in one shot for speed
            data = attributes_df.values.tolist()
            if data:
                # build a 2D list with headers prepended
                # then write via a single Range assignment
                start_cell = ws.Cells(2, 13)
                end_cell   = ws.Cells(1 + len(data), 12 + len(attributes_df.columns))
                ws.Range(start_cell, end_cell).Value = data

            # 6) Run the VBA macro
            macro = f"{wb.Name}!CalculateResults.CalculateResults"
            excel.Application.Run(macro)

            # 7) Save & close Excel
            wb.Save()
            wb.Close(SaveChanges=True)
            excel.Quit()

            # 8) Read back the results sheet
            result_df = pd.read_excel(str(file_path), sheet_name="Risk Results")
            return result_df.loc[:, "BB":]

        except Exception as e:
            try:
                if 'wb' in locals():
                    wb.Close(False)
                if 'excel' in locals():
                    excel.Quit()
            except:
                pass
            raise RuntimeError(f"CycleRAP calculation failed: {e}") from e

        finally:
            pythoncom.CoUninitialize()

    @classmethod
    def evaluate_treatment_suggestions(cls, gpd_df : gpd.GeoDataFrame, attributes_df : pd.DataFrame) -> Treatment:
        """
        Evaluate treatment suggestions using the CycleRAP Excel workbook.

        Note: This method requires Windows and the pywin32 package for Excel COM automation.
        """
        # Platform check: Ensure we're on Windows with pywin32 installed
        # This will raise RuntimeError if not available
        check_windows_feature("Treatment evaluation (Excel automation)")

        # Get Windows-specific modules dynamically
        pythoncom = get_pythoncom()
        win32 = get_excel_client()

        file_path = Path(cls.source_dir) / CYCLERAP_SOURCE
        pythoncom.CoInitialize()
        try:
            # 1) Launch Excel COM
            excel = win32.Dispatch('Excel.Application')
            excel.Visible = False
            excel.DisplayAlerts = False

            # 2) Open workbook
            wb = excel.Workbooks.Open(str(file_path))

            # 3) Get the target sheet and clear old contents
            ws = wb.Worksheets("Upload_data")
            # determine how many rows & columns are in use
            used = ws.UsedRange
            last_row = used.Row + used.Rows.Count - 1   # usually Row is 1 anyway
            last_col = used.Column + used.Columns.Count - 1

            # only clear rows 2 through last_row
            if last_row >= 2:
                ws.Range(
                    ws.Cells(2, 1),
                    ws.Cells(last_row, last_col)
                ).ClearContents()

            # 5) Write data rows in one shot for speed
            data = attributes_df.values.tolist()
            if data:
                # build a 2D list with headers prepended
                # then write via a single Range assignment
                start_cell = ws.Cells(2, 13)
                end_cell   = ws.Cells(1 + len(data), 12 + len(attributes_df.columns))
                ws.Range(start_cell, end_cell).Value = data

            image_refs = gpd_df.loc[:, ProjectGeoData.Fields.IMAGE_REFERENCE_STR].tolist()

            if image_refs:
                # Excel expects a 2D list (rows of rows), so we need to wrap each item in a list
                image_refs_2d = [[val] for val in image_refs]

                start_cell = ws.Cells(2, 4)  # Start at row 2, column "Image Reference"
                end_cell = ws.Cells(1 + len(image_refs_2d), 4)  # Still column "Image Reference"

                ws.Range(start_cell, end_cell).Value = image_refs_2d

            # 6) Run the VBA macro
            macro = f"{wb.Name}!srSTM"
            excel.Application.Run(macro)

            # 7) Save & close Excel
            wb.Save()
            wb.Close(True)
            excel.Quit()

            # 8) Read back the results sheet
            treatment_df = pd.read_excel(str(file_path), sheet_name="STM Results")

            project_treatment : Treatment = Treatment(len(treatment_df))
            project_treatment.loc[:, Treatment.Fields.IMAGE_REFERENCE_STR]  = treatment_df.loc[:, Treatment.Fields.IMAGE_REFERENCE_STR]
            project_treatment.loc[:, Treatment.Fields.TREATMENT_ID_STR]     = treatment_df.loc[:, Treatment.Fields.TREATMENT_ID_STR]
            project_treatment.loc[:, Treatment.Fields.TREATMENT_RANK_STR]   = treatment_df.loc[:, Treatment.Fields.TREATMENT_RANK_STR]
            project_treatment.loc[:, Treatment.Fields.TREATMENT_NAME_STR]   = treatment_df.loc[:, Treatment.Fields.TREATMENT_NAME_STR]
            project_treatment.loc[:, Treatment.Fields.BB_REMEDIED_STR]      = treatment_df.loc[:, Treatment.Fields.BB_REMEDIED_STR]
            project_treatment.loc[:, Treatment.Fields.BP_REMEDIED_STR]      = treatment_df.loc[:, Treatment.Fields.BP_REMEDIED_STR]
            project_treatment.loc[:, Treatment.Fields.SB_REMEDIED_STR]      = treatment_df.loc[:, Treatment.Fields.SB_REMEDIED_STR]
            project_treatment.loc[:, Treatment.Fields.VB_REMEDIED_STR]      = treatment_df.loc[:, Treatment.Fields.VB_REMEDIED_STR]
            project_treatment.loc[:, Treatment.Fields.SCORE_REMEDIED_STR]   = treatment_df.loc[:, Treatment.Fields.SCORE_REMEDIED_STR]

            return project_treatment

        except Exception as e:
            try:
                if 'wb' in locals():
                    wb.Close(False)
                if 'excel' in locals():
                    excel.Quit()
            except:
                pass
            raise RuntimeError(f"CycleRAP calculation failed: {e}") from e

        finally:
            pythoncom.CoUninitialize()

    @classmethod
    def get_treatment_pairs(cls, treatment_id: int):
        """
        Returns a list of (attribute, code_remedy) pairs for the treatment row at the given index.
        Skips any pairs where either value is NaN or None.
        
        Parameters:
            row_index (int): Index of the row in treatment_df.
        
        Returns:
            List[Tuple[int, int]]: A list of (attribute, remedy) pairs.
        """
        row_index = treatment_id - 1

        if row_index < 0 or row_index >= len(cls.treatment_solutions):
            raise IndexError("Row index out of range.")

        row = cls.treatment_solutions.iloc[row_index]
        row_pairs = []

        for i in range(1, 4):
            attr = row.get(f"attribute_{i}")
            code = row.get(f"code_remedy_{i}")
            if pd.notna(attr) and pd.notna(code):
                row_pairs.append((int(attr), int(code)))

        return row_pairs
    
    @staticmethod
    def _write_default_config(path: Path):
        # Build default attribute dict
        default_attrs = {
            Attributes.Fields.AREA_TYPE_STR                     : 2,
            Attributes.Fields.FACILITY_TYPE_STR                 : 1,
            Attributes.Fields.FACILITY_ACCESS_STR               : 1,
            Attributes.Fields.LOOSE_SLIPPERY_SURFACE_STR        : 2,
            Attributes.Fields.TRAM_TRAIN_RAIL_STR               : 2,
            Attributes.Fields.DEFORMATION_DRAIN_STR             : 2,
            Attributes.Fields.FIXED_OBSTACLE_STR                : 2,
            Attributes.Fields.NON_FIXED_OBSTACLE_STR            : 2,
            Attributes.Fields.DELINEATION_STR                   : 2,
            Attributes.Fields.LIGHT_SEGREGATION_STR             : 1,
            Attributes.Fields.FACILITY_WIDTH_STR                : 2,
            Attributes.Fields.FLOW_DIR_STR                      : 2,
            Attributes.Fields.WIDTH_RESTRICTION_STR             : 2,
            Attributes.Fields.ADJ_ROAD_LANE_01M_STR             : 2,
            Attributes.Fields.ADJ_VHCL_PARKING_01M_STR          : 2,
            Attributes.Fields.ADJ_SVR_PARKING_01M_STR           : 2,
            Attributes.Fields.ADJ_OBJ_LVL_CHGE_01M_STR          : 2,
            Attributes.Fields.ADJ_SIDEWALK_01M_STR              : 2,
            Attributes.Fields.ADJ_ROAD_LANE_13M_STR             : 2,
            Attributes.Fields.ADJ_VHCL_PARKING_13M_STR          : 2,
            Attributes.Fields.ADJ_SVR_HAZARD_13M_STR            : 2,
            Attributes.Fields.ADJ_OBJ_LVL_CHGE_13M_STR          : 2,
            Attributes.Fields.ADJ_SIDEWALK_13M_STR              : 2,
            Attributes.Fields.GRADE_STR                         : None,
            Attributes.Fields.CURV_STR                          : 2,
            Attributes.Fields.STREET_LIGHT_STR                  : 1,
            Attributes.Fields.PED_CROSS_STR                     : 2,
            Attributes.Fields.INTERSECT_FACILITY_STR            : 2,
            Attributes.Fields.INTERSECT_APPRCH_STR              : 2,
            Attributes.Fields.INTERSECT_ROAD_CROSS_STR          : 2,
            Attributes.Fields.CROSS_FACILITY_STR                : 2,
            Attributes.Fields.NOL_ADJ_ROAD_STR                  : 2,
            Attributes.Fields.NOL_INTERSECT_ROAD_STR            : 1,
            Attributes.Fields.PROP_ACCESS_STR                   : 2,
            Attributes.Fields.PEAK_PED_FLOW_STR                 : 1,
            Attributes.Fields.PEAK_BICYCLE_TRAFFIC_FLOW_STR     : 1,
            Attributes.Fields.OBSERVED_PROPORTION_STR           : 1,
            Attributes.Fields.BICYCLE_SPD_AVG_STR               : 1,
            Attributes.Fields.BICYCLE_SPD_DIFF_STR              : 1,
            Attributes.Fields.ROAD_AADT_STR                     : 6000,
            Attributes.Fields.HEAVY_VHCL_FLOW_STR               : 1,
            Attributes.Fields.SPD_LIMIT_STR                     : 10,
            Attributes.Fields.ROAD_OPR_SPEED_AVG_STR            : 30,
            Attributes.Fields.SPEED_UNIT_STR                    : 1
        }

        # Build default treatment list
        default_treatments = [
            {"description": "Upgrade existing facility to an on-road bicycle lane with light segregation", "attribute_1": 14, "code_remedy_1": 4,  "attribute_2": 22, "code_remedy_2": 1,  "attribute_3": 15, "code_remedy_3": 1},
            {"description": "Upgrade existing facility to an on-road bicycle lane with safety barrier (Adjacent road lane 0-1m)", "attribute_1": 26, "code_remedy_1": 2,  "attribute_2": 15, "code_remedy_2": 1,  "attribute_3": None, "code_remedy_3": None},
            {"description": "Upgrade existing facility to an on-road bicycle lane with safety barrier (Adjacent road lane 1-3m)", "attribute_1": 31, "code_remedy_1": 2,  "attribute_2": 15, "code_remedy_2": 2,  "attribute_3": None, "code_remedy_3": None},
            {"description": "Upgrade existing facility to a cycling-priority street", "attribute_1": 55, "code_remedy_1": 20, "attribute_2": 15, "code_remedy_2": 1,  "attribute_3": None, "code_remedy_3": None},
            {"description": "Upgrade existing facility to a cycling-priority street (mph)", "attribute_1": 55, "code_remedy_1": 12, "attribute_2": 15, "code_remedy_2": 2,  "attribute_3": None, "code_remedy_3": None},
            {"description": "Upgrade existing facility to a multi-use path", "attribute_1": 14, "code_remedy_1": 2,  "attribute_2": 23, "code_remedy_2": 3,  "attribute_3": 15, "code_remedy_3": 1},
            {"description": "Upgrade existing facility to an off-road bicycle path", "attribute_1": 14, "code_remedy_1": 3,  "attribute_2": 15, "code_remedy_2": 1,  "attribute_3": None, "code_remedy_3": None},
            {"description": "Upgrade existing facility to a one-way bicycle facility", "attribute_1": 24, "code_remedy_1": 1,  "attribute_2": 15, "code_remedy_2": 1,  "attribute_3": None, "code_remedy_3": None},
            {"description": "Improve surface conditions", "attribute_1": 16, "code_remedy_1": 2,  "attribute_2": None, "code_remedy_2": None, "attribute_3": None, "code_remedy_3": None},
            {"description": "Install light segregation", "attribute_1": 22, "code_remedy_1": 1,  "attribute_2": None, "code_remedy_2": None, "attribute_3": None, "code_remedy_3": None},
            {"description": "Install lighting", "attribute_1": 38, "code_remedy_1": 1,  "attribute_2": None, "code_remedy_2": None, "attribute_3": None, "code_remedy_3": None},
            {"description": "Clear facility – Remove fixed obstacle/s", "attribute_1": 19, "code_remedy_1": 2,  "attribute_2": None, "code_remedy_2": None, "attribute_3": None, "code_remedy_3": None},
            {"description": "Clear facility – Remove non-fixed obstacle/s", "attribute_1": 20, "code_remedy_1": 2,  "attribute_2": None, "code_remedy_2": None, "attribute_3": None, "code_remedy_3": None},
            {"description": "Clear facility – Remove width restriction", "attribute_1": 25, "code_remedy_1": 2,  "attribute_2": None, "code_remedy_2": None, "attribute_3": None, "code_remedy_3": None},
            {"description": "Improve facility access", "attribute_1": 15, "code_remedy_1": 1,  "attribute_2": None, "code_remedy_2": None, "attribute_3": None, "code_remedy_3": None},
            {"description": "Redesign the curve", "attribute_1": 37, "code_remedy_1": 2,  "attribute_2": None, "code_remedy_2": None, "attribute_3": None, "code_remedy_3": None},
            {"description": "Widen the facility", "attribute_1": 23, "code_remedy_1": 3,  "attribute_2": None, "code_remedy_2": None, "attribute_3": None, "code_remedy_3": None},
            {"description": "Install protective barrier", "attribute_1": 28, "code_remedy_1": 2,  "attribute_2": None, "code_remedy_2": None, "attribute_3": None, "code_remedy_3": None},
            {"description": "Improve delineation", "attribute_1": 21, "code_remedy_1": 1,  "attribute_2": None, "code_remedy_2": None, "attribute_3": None, "code_remedy_3": None},
            {"description": "Review intersection approach", "attribute_1": 41, "code_remedy_1": 2,  "attribute_2": None, "code_remedy_2": None, "attribute_3": None, "code_remedy_3": None},
            {"description": "Improve safety of crossing design", "attribute_1": 43, "code_remedy_1": 1,  "attribute_2": None, "code_remedy_2": None, "attribute_3": None, "code_remedy_3": None},
            {"description": "Evaluate need for grade separation", "attribute_1": 42, "code_remedy_1": 2,  "attribute_2": None, "code_remedy_2": None, "attribute_3": None, "code_remedy_3": None},
            {"description": "Reconfigure or remove parking", "attribute_1": 27, "code_remedy_1": 2,  "attribute_2": None, "code_remedy_2": None, "attribute_3": None, "code_remedy_3": None},
            {"description": "Review configuration of train/tram rails", "attribute_1": 17, "code_remedy_1": 2,  "attribute_2": None, "code_remedy_2": None, "attribute_3": None, "code_remedy_3": None},
            {"description": "Install traffic calming (km/h)", "attribute_1": 55, "code_remedy_1": 30, "attribute_2": None, "code_remedy_2": None, "attribute_3": None, "code_remedy_3": None},
            {"description": "Install traffic calming (mph)", "attribute_1": 55, "code_remedy_1": 20, "attribute_2": None, "code_remedy_2": None, "attribute_3": None, "code_remedy_3": None},
            {"description": "Vehicles speed control", "attribute_1": 55, "code_remedy_1": 30, "attribute_2": None, "code_remedy_2": None, "attribute_3": None, "code_remedy_3": None},
            {"description": "Bicycles speed control", "attribute_1": 50, "code_remedy_1": 1,  "attribute_2": None, "code_remedy_2": None, "attribute_3": None, "code_remedy_3": None}
        ]

        # Dump them into one JSON
        payload = {
            "attribute_default": default_attrs,
            "treatment_remedy": default_treatments
        }

        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=4)