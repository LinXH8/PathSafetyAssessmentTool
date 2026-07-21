from __future__ import annotations
import re
import os
import json
import datetime
import hashlib
import app.services.global_var as global_var
import app.services.serializer as serializer
import pandas as pd
import shutil
import geopandas as gpd
import app.services.cycleRAP_interface as cycleRAP_interface
from pathlib import Path
from shapely.geometry import LineString, Point
from shapely import wkt
from app.services.cycleRAP_VA import gdfify, get_full_path
import app.services.paths as paths

# ─── Facade re-exports (S3.6 modularization) ──────────────────────────────────
# These implementations were relocated into focused modules but MUST remain
# importable from ``app.services.project_manager`` — ~13 modules under
# ``app/api/projects/`` and two test files depend on this import path.
#
#   * image_storage    — image materialization + cross-project deduplication
#   * project_version  — ProjectVersion (per-version data access + serialization)
#   * project          — Project (version selection, geo-data, metadata, copy)
#
# NOTE (tests): both image test modules monkeypatch
# ``app.services.project_manager.os.link``. ``os`` is imported above and is a
# process-wide singleton, so that patch also reaches ``image_storage``'s
# ``os.link`` calls. Keep ``import os`` here.
from app.services.image_storage import (
    materialize_project_image,
    deduplicate_project_images,
)
from app.services.project_version import ProjectVersion
from app.services.project import Project


# Controller for managing the overall projects
class project_manager:
    DEFAULT_CONFIG = {
        # Folder paths
        "destination_folder": "../data",
        "source_folder": "src",
        "in_folder": "../in",
        "CycleRAP_source": global_var.CYCLERAPVER,
        # Video config
        "capture_frequency": 10,  # GPS sampling rate in Hz
        # Name configurations
        "project_prefix": "",
        # Persistent states
        "current_project": None,
    }

    def __init__(self) -> None:
        # Path variables
        self.des_path : Path            = None
        self.src_path : Path            = None
        self.in_path  : Path            = None
        self.cycleRAP_model_src : Path  = None

        # Application-level variables
        self.shapefile                                                  = None
        self.capture_freq                                               = None

        # NOTE: Variable deprecated but still kept for backwards compatibility,
        # Use the cycleRAP_interface class methods instead
        self.cyclerap_interface : cycleRAP_interface.cycleRAP_interface = cycleRAP_interface.cycleRAP_interface

        self._initialise()

    # Initialises all path and application-level variables
    def _initialise(self) -> None:
        # Create config if not existing
        if not get_config_path().exists():
            self.save_config(self.DEFAULT_CONFIG)

        try:
            with open(get_config_path(), 'r') as json_file:
                data = json.load(json_file)
        except (json.JSONDecodeError, ValueError):
            # Corrupted or empty config — recreate from defaults and retry once
            print("[PM] WARNING: config.json is corrupted, recreating from defaults.", flush=True)
            self.save_config(self.DEFAULT_CONFIG)
            with open(get_config_path(), 'r') as json_file:
                data = json.load(json_file)

        self.load_config(data)
        self._discover_projects()


# ================================================================================================================
# UTILITY
# ================================================================================================================
    def _discover_projects(self) -> None:
        if self.des_path is None:
            raise ValueError("self.des_path is not set. Please initialise it before discovering projects.")

        print(f"[PM] Discovering projects in: {self.des_path.resolve()}", flush=True)
        try:
            # NOTE: we might want to change to a random access data structure for more efficient look-up
            self.projects : list[Project] = [
                Project(p) for p in self.des_path.iterdir() if p.is_dir()
            ]
            print(f"[PM] Found {len(self.projects)} project(s).", flush=True)
        except FileNotFoundError:
            print(f"[PM] ERROR: Project destination folder '{self.des_path}' does not exist.", flush=True)
            self.projects = []
        except Exception as e:
            print(f"[PM] ERROR: Failed to discover projects: {e}", flush=True)
            self.projects = []

    def delete_project(self, project_name: str) -> bool:
        for proj in self.projects:
            if proj.metadata.project_name == project_name:
                proj._delete()
                self.projects.remove(proj)
                return True

        raise KeyError(f"Project not found: {project_name}")

    def list_names(self) -> list[str]:
        return [p.project_path.name for p in self.projects]

    def project(self, project_name: str) -> Project:
        for proj in self.projects:
            if proj.metadata.project_name ==  project_name:
                return proj
        raise KeyError(f"Project not found: {project_name}")

    def create_project(
        self,
        project_title: str,
        geo_data: gpd.GeoDataFrame,
        dataset_name: str,
        tags: list | None = None,
        source_folders: list | None = None,
    ) -> None:
        proj_root = self.des_path / project_title

        # Image references come directly from geo_data FILENAME — no copying or renaming.
        # Images remain in in/ and are resolved at serve time.
        image_ref = list(geo_data["FILENAME"]) if "FILENAME" in geo_data.columns else []
        size = len(image_ref)

        # Craft project metadata
        now_dt = datetime.datetime.now()
        project_metadata = serializer.ProjectMetadata()
        project_metadata.project_name   = project_title
        project_metadata.date_created   = now_dt
        project_metadata.last_updated   = now_dt
        project_metadata.created_by     = "default"
        project_metadata.dataset        = dataset_name
        project_metadata.source_folders = source_folders if source_folders is not None else ([dataset_name] if dataset_name and dataset_name != "MULTI_FOLDER_SELECTION" else [])
        project_metadata.progress       = []
        project_metadata.size           = size
        project_metadata.tags           = tags if tags is not None else []

        # Craft geo data csv
        geo_tbl = serializer.ProjectGeoData(size)
        geo_tbl.loc[:, serializer.ProjectGeoData.Fields.IMAGE_REFERENCE_STR] = image_ref[:size]
        geo_tbl.populate_linestring(geo_data)

        # Craft version 1 snapshot metadata
        snapshot_dataframe = serializer.SnapshotMetadata(size)


        # Craft default attributes
        attribute_dataframe = serializer.Attributes(size, self.cyclerap_interface.attribute_default_values)

        # Create project
        new_project = Project(proj_root)
        new_project.create_new_version()

        # Initialise project var
        new_project.geo_data = geo_tbl
        new_project.metadata = project_metadata
        new_project.latest().attributes = attribute_dataframe
        new_project.latest().snapshot_metadata = snapshot_dataframe
        # Treatment and Results should remain empty
        new_project.latest().results = serializer.Results()
        new_project.latest().treatment = serializer.Treatment()

        # Write project to file
        new_project.save_all()
        new_project.metadata.serialize(new_project.project_path)

        self.projects.append(new_project)

    # Search the entire project repository and create a temporary project based on the filter
    def create_temporary_project(self, filter_input : serializer.ProjectMetadata) -> Project:
        return self.merge_project_list(self.search(filter_input))

    def merge_project(self, lhs_name : str, rhs_name : str) -> Project:
        return self.project(lhs_name) + self.project(rhs_name)

    def merge_project_list(self, project_list : list[str] | list[Project]) -> Project:
        if all(isinstance(p, str) for p in project_list):
            project_list = [self.project(name) for name in project_list]

        merged = Project()

        # Change metadata
        merged.metadata.project_name = "Merged"

        # Merge geo data
        geo_dfs = [p.geo_data.df for p in project_list]
        merged._geo_data.df = pd.concat(geo_dfs, ignore_index=True)

        # Merge versions
        attr_dfs = [p.latest().attributes.df for p in project_list]
        merged.latest()._attributes._df = pd.concat(attr_dfs, ignore_index=True)

        result_dfs = [p.latest().results.df for p in project_list]
        merged.latest()._results._df = pd.concat(result_dfs, ignore_index=True)

        treatment_dfs = [p.latest().treatment.df for p in project_list]
        merged.latest()._treatment._df = pd.concat(treatment_dfs, ignore_index=True)

        snapshot_dfs = [p.latest().snapshot_metadata.df for p in project_list]
        merged.latest()._snapshot_metadata._df = pd.concat(snapshot_dfs, ignore_index=True)

        return merged


    # Search the project with the filter criteria
    def search(self, filter_input : serializer.ProjectMetadata = None, filter_attributes: dict = None, filter_treatment: dict = None, filter_results: dict = None) -> list[Project]:
        found : list[Project] = []

        for project in self.projects:
            meta = project.metadata
            match = True

            # Match progress (meta.progress <= filter_input.progress)
            # if ( meta.progress / meta.size * 100 ) > filter_input.progress:
            #     match = False
            #     continue

            # Match project_name (case-insensitive substring match to any name in the list)
            if filter_input.project_name:
                if not meta.project_name:
                    match = False
                    continue
                else:
                    # Ensure filter_input.project_name is a list
                    filter_names = filter_input.project_name if isinstance(filter_input.project_name, list) else [filter_input.project_name]
                    if not any(name.lower() in meta.project_name.lower() for name in filter_names):
                        match = False
                        continue

            # Match created_by (exact)
            if filter_input.created_by:
                if filter_input.created_by != meta.created_by:
                    match = False
                    continue

            # Match dataset (exact)
            if filter_input.dataset:
                if filter_input.dataset != meta.dataset:
                    match = False
                    continue

            # Match size (meta.size <= filter_input.size)
            if filter_input.size is not None:
                if meta.size is None or meta.size > filter_input.size:
                    match = False
                    continue

            # Match date_created <= filter_input.date_created
            if filter_input.date_created:
                if not meta.date_created or meta.date_created > filter_input.date_created:
                    match = False
                    continue

            # Match last_updated <= filter_input.last_updated
            if filter_input.last_updated:
                if not meta.last_updated or meta.last_updated > filter_input.last_updated:
                    match = False
                    continue

            # Match tags (all filter_input tags must be present in meta.tags)
            if filter_input.tags:
                # Normalize to list of lowercase tags (strip whitespace)
                if isinstance(filter_input.tags, str):
                    filter_tags = [t.strip().lower() for t in filter_input.tags.split(",") if t.strip()]
                elif isinstance(filter_input.tags, list):
                    filter_tags = [t.lower() for t in filter_input.tags if isinstance(t, str)]
                else:
                    filter_tags = []

                # Normalize meta tags too
                meta_tags = [t.lower() for t in (meta.tags or [])]

                # All filter tags must be present in meta tags
                if not all(tag in meta_tags for tag in filter_tags):
                    match = False
                    continue

            if match:
                found.append(project)

        return found


# ================================================================================================================
# SERIALIZATION
# ================================================================================================================

    def load_config(self, config: dict) -> dict:
        # Writable roots resolve via paths.py so they can live outside the
        # install directory (see paths.py). In a source checkout these are
        # byte-identical to the old "../data"/"../in" resolution.
        # src_path stays install-relative: the CycleRAP workbook is read-only
        # app data, not user data.
        self.des_path   = paths.resolve_configured_dir(config.get("destination_folder"), paths.projects_dir())
        self.src_path   = Path(get_full_path(config.get("source_folder")))
        self.in_path    = paths.resolve_configured_dir(config.get("in_folder"), paths.in_dir())
        self.capture_freq       = config.get("capture_frequency")
        self.cycleRAP_model_src = config.get("CycleRAP_source")
        self.project_name       = config.get("current_project")

        return config

    def save_config(self, config: dict) -> None:
        with open(get_config_path(), "w") as json_file:
            json.dump(config, json_file, indent=4)

    def write_config(self, key: str, value) -> None:
        with open(get_config_path(), "r") as json_file:
            data = json.load(json_file)
        data[key] = value
        self.save_config(data)

    # TODO (ONCE ACTIVE VERSION CONTROL HAS BEEN IMPLEMENTED): Project has to be opened to save
    def save_project(self, project_name: str = None) -> bool:
        pass

    # TODO (ONCE ACTIVE VERSION CONTROL HAS BEEN IMPLEMENTED): Loads all project-level variables from project directory
    def read_project(self, project_name: Path, best_before=None) -> None:
        self.project.project_path = self.des_path / project_name

        if best_before is not None:
            self.project.open_best_before(best_before)
        else:
            self.project.open_latest()
        pass


# ================================================================================================================
# LOCAL
# ================================================================================================================

def load_images_from_folder_cv(folder: str) -> list[str]:
    image_array: list[str] = []

    for filename in os.listdir(folder):
        if filename.lower().endswith((".jpg", ".jpeg")):
            image_array.append(filename)

    def extract_numeric_key(filename: str) -> int:
        # Search for "Cam" in the filename
        cam_match = re.search(r"Cam\d+", filename)

        if cam_match:
            # Extract from the Cam part onwards
            cam_section = filename[cam_match.start():]
            nums = re.findall(r'\d+', cam_section)
            if len(nums) >= 2:
                # Skip the camera number, use the remaining numeric parts
                key_str = "".join(nums[1:])
            else:
                key_str = "".join(nums)
        else:
            # No "Cam" found, fallback to all digits in full filename
            nums = re.findall(r'\d+', filename)
            key_str = "".join(nums) if nums else "0"

        return int(key_str)

    return sorted(image_array, key=extract_numeric_key)

def get_config_path() -> Path:
    # Writable config location -- see services/paths.config_path().
    return paths.config_path()

def rename_files_with_prefix(directory: str, prefix: str) -> None:
    """
    Rename all files in the given directory by adding a prefix to their filenames.

    Parameters:
        directory (str): Path to the target directory.
        prefix (str): Prefix to add to each file name.
    """
    dir_path = Path(directory)

    if not dir_path.is_dir():
        raise ValueError(f"The path '{directory}' is not a valid directory.")

    for file in dir_path.iterdir():
        if file.is_file():
            new_name = prefix + file.name
            new_path = file.with_name(new_name)
            file.rename(new_path)
