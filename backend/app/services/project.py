"""Project-level orchestration: versions, geo-data, metadata, segment copy/delete.

Extracted from ``project_manager`` (S3.6). ``Project`` selects among
``ProjectVersion`` snapshots and owns the non-versioned project metadata and
geo-data. Re-exported from ``app.services.project_manager`` to keep the
historical import path stable.
"""
from __future__ import annotations
import os
import datetime
import shutil
import app.services.global_var as global_var
import app.services.serializer as serializer
import pandas as pd
from pathlib import Path

from app.services.project_version import ProjectVersion
from app.services.image_storage import materialize_project_image


# In charge of the selection of project versions and project metadata
class Project:
    def __init__(self, project_path: Path = None) -> None:
        self.project_path = project_path               #  …/ProjectA
        self._metadata : serializer.ProjectMetadata | None  = None
        self._geo_data : serializer.ProjectGeoData  | None  = None
        self._meta_dirty = False
        self._geo_dirty = False
        self.versions: list[ProjectVersion] = []

        if project_path is None:
            self._metadata : serializer.ProjectMetadata = serializer.ProjectMetadata()
            self._geo_data : serializer.ProjectGeoData  = serializer.ProjectGeoData()
            self.versions.insert(0, ProjectVersion())

    # ─── Version handling ─────────────────────────────────────
    def _discover_versions(self) -> None:
        version_dir = self.project_path / "versions"
        self.versions: list[ProjectVersion] = [
            ProjectVersion(p)
            for p in version_dir.iterdir()
            if p.is_dir() and p.name.isdigit() and len(p.name) == 8
        ]
        self.versions.sort(key=lambda v: v.date, reverse=True) # v is a ProjectVersion object, reverse=True sorts date in descending order

    def latest(self) -> ProjectVersion:
        if not self.versions:
            self._discover_versions()
            if not self.versions:
                raise ValueError(f"No dated sub-folders in {self.project_path}")
        return self.versions[0]

    def by_date(self, yyyymmdd: str) -> ProjectVersion:
        for v in self.versions:
            if v.path.name == yyyymmdd:
                return v
        raise ValueError(f"{yyyymmdd} not found in {self.project_path}")

    def create_new_version(self, version : ProjectVersion = None) -> ProjectVersion:
        yyyymmdd = datetime.datetime.now().strftime("%Y%m%d")
        ver_path = self.project_path / "versions" / yyyymmdd

        # 2) bail out if already present ---------------------------------------
        if ver_path.exists():
            raise FileExistsError(f"Version {yyyymmdd} already exists in {self.project_path}")

        # 3) create the directory ----------------------------------------------
        ver_path.mkdir(parents=True)

        # 4) build ProjectVersion object & register it -------------------------
        if version is not None:
            ver_obj = version
            ver_obj.path = ver_path
            # Mark all data as dirty so it gets saved to the new version directory
            # This ensures attributes, snapshot_metadata, etc. are copied forward
            # Access properties (not _internal) to trigger lazy loading if needed
            try:
                ver_obj.attributes.df_dirty = True
            except Exception:
                pass  # If attributes can't be loaded, skip
            try:
                ver_obj.snapshot_metadata.df_dirty = True
            except Exception:
                pass
            try:
                ver_obj.treatment.df_dirty = True
            except Exception:
                pass
            try:
                ver_obj.results.df_dirty = True
            except Exception:
                pass
        else:
            ver_obj = ProjectVersion(ver_path)

        self.versions.insert(0, ver_obj)

        return ver_obj

    def save_all(self) -> Path:
        yyyymmdd = datetime.datetime.now().strftime("%Y%m%d")
        today_ver_path = self.project_path / "versions" / yyyymmdd
        if not today_ver_path.exists():
            # Only create a new version when today's directory does not yet exist
            self.create_new_version(self.latest())

        # NOTE: metadata is NOT serialized here intentionally.
        # Callers are responsible for setting last_updated and calling
        # metadata.serialize() explicitly, so only the intended project
        # gets its timestamp updated.
        if self.geo_data.df_dirty is True:
            self.geo_data.serialize(self.project_path)
        self.latest().save_all()
        return self.project_path

    def _delete(self) -> None:
        # Delete project directory
        shutil.rmtree(self.project_path, ignore_errors=True)

    def delete_segment(self, index: int) -> None:
        # 0. Delete Associated Image (from Geo Data info)
        try:
            if self.geo_data.df is not None and index < len(self.geo_data.df):
                row = self.geo_data.df.iloc[index]
                # Try common column names for image reference
                img_ref = None
                for col in ["Image Reference", "image", "img"]:
                    if col in row:
                        img_ref = row[col]
                        break

                if img_ref and isinstance(img_ref, str):
                    image_path = self.project_path / global_var.PROJECT_IMAGES_FOLDER / img_ref
                    if image_path.exists() and image_path.is_file():
                        os.remove(image_path)
        except Exception as e:
            print(f"Error deleting image for segment {index}: {e}")

        # Delete from Geo Data
        # Delete from Geo Data
        if self.geo_data.df is not None and index < len(self.geo_data.df):
            self.geo_data.df = self.geo_data.df.drop(index).reset_index(drop=True)
            self.geo_data.df_dirty = True

        # Delete from latest version data
        self.latest().delete_segment(index)

        # Update Metadata
        if self.metadata.size is not None and self.metadata.size > 0:
            self.metadata.size -= 1

        # We can't easily know if the deleted segment was verified or autocoded without checking previous state
        # But we can re-calculate verified count if needed, or just decrement if we tracked indices
        # For now, let's just save.

        self.save_all()

    def delete_segments(self, indices: list[int]) -> None:
        # 0. Delete Associated Images (from Geo Data info)
        try:
            if self.geo_data.df is not None:
                # Filter valid indices
                valid_indices = [i for i in indices if i < len(self.geo_data.df)]

                # Identify image paths to delete
                images_to_delete = []
                for idx in valid_indices:
                    row = self.geo_data.df.iloc[idx]
                    img_ref = None
                    for col in ["Image Reference", "image", "img"]:
                        if col in row:
                            img_ref = row[col]
                            break

                    if img_ref and isinstance(img_ref, str):
                        image_path = self.project_path / global_var.PROJECT_IMAGES_FOLDER / img_ref
                        images_to_delete.append(image_path)

                # Delete images
                for img_path in images_to_delete:
                    try:
                        if img_path.exists() and img_path.is_file():
                            os.remove(img_path)
                    except Exception as e:
                        # Continue deleting others even if one fails
                        print(f"Error deleting image {img_path}: {e}")

        except Exception as e:
            print(f"Error in batch image deletion: {e}")

        # Delete from Geo Data
        if self.geo_data.df is not None:
            valid_indices = [i for i in indices if i < len(self.geo_data.df)]
            if valid_indices:
                self.geo_data.df = self.geo_data.df.drop(valid_indices).reset_index(drop=True)
                self.geo_data.df_dirty = True

        # Delete from latest version data
        self.latest().delete_segments(indices)

        # Update Metadata
        if self.metadata.size is not None:
            # We removed len(valid_indices), but safe to just recount or subtract
            # Recounting is safer if possible, but indices logic above assumes alignment
            # Subtracting the actual number of dropped rows
            count_removed = len(valid_indices) if 'valid_indices' in locals() else len(indices)
            self.metadata.size = max(0, self.metadata.size - count_removed)

        self.save_all()

        self.save_all()

    def check_collisions(self, indices: list[int], target_project: 'Project') -> list[str]:
        """
        Check if segments specified by indices already exist in target_project based on Image Reference.
        Returns a list of colliding Image References.
        """
        source_geo = self.geo_data.df
        valid_indices = [i for i in indices if i < len(source_geo)]
        if not valid_indices:
            return []

        subset_geo = source_geo.iloc[valid_indices]

        target_geo = target_project.geo_data.df
        if target_geo is None or target_geo.empty:
            return []

        collisions = []
        # optimization: get set of target image refs
        if "Image Reference" in target_geo.columns:
            # Drop NAs and ensure we ignore empty strings or "nan"
            # astype(str) converts NaN to "nan" if we are not careful with dropna first
            target_series = target_geo["Image Reference"].dropna()
            # Filter out empty or whitespace only strings, and literal "nan"
            target_imgs = {str(x) for x in target_series if str(x).strip() and str(x).lower() != 'nan'}

            source_name = self.metadata.project_name
            target_name = target_project.metadata.project_name

            for _, row in subset_geo.iterrows():
                img_ref = row.get("Image Reference")
                # Check for validity before string conversion to be safe
                if pd.notna(img_ref):
                    s_ref = str(img_ref).strip()
                    if s_ref and s_ref.lower() != 'nan':
                        # PREDICT renaming
                        check_ref = s_ref
                        if s_ref.startswith(source_name):
                             check_ref = s_ref.replace(source_name, target_name, 1)

                        if check_ref in target_imgs:
                            collisions.append(check_ref)

        if collisions:
            print(f"DEBUG: Found {len(collisions)} collisions. Examples: {collisions[:3]}")

        return collisions

    def copy_segments(self, indices: list[int], target_project: 'Project', replace: bool = False) -> int:
        """
        Copy segments (and their images) specified by indices from self (source) to target_project.
        """
        # 1. Get filtered data from source (latest version + geo_data)
        # We can reuse the logic from search/create_temporary_project but specific to indices

        source_geo = self.geo_data.df
        source_attr = self.latest().attributes.df
        source_res = self.latest().results.df
        source_treat = self.latest().treatment.df
        source_imgs = []

        # Validate indices
        valid_indices = [i for i in indices if i < len(source_geo)]
        if not valid_indices:
            return 0

        # Extract rows
        # Extract rows
        # Use reindex instead of iloc to handle cases where other DFs might be shorter than geo_df
        # This aligns everything to valid_indices (based on geo_df), filling missing with NaN
        subset_geo = source_geo.iloc[valid_indices].copy().reset_index(drop=True)
        subset_attr = source_attr.reindex(valid_indices).copy().reset_index(drop=True)
        subset_res = source_res.reindex(valid_indices).copy().reset_index(drop=True)

        subset_treat = pd.DataFrame()
        if not source_treat.empty:
             subset_treat = source_treat.reindex(valid_indices).copy().reset_index(drop=True)

        # 1.5 Handle Replacement
        if replace and target_project.geo_data.df is not None and not target_project.geo_data.df.empty:
            target_geo = target_project.geo_data.df
            target_geo = target_project.geo_data.df
            # Update: We need to predict the new image names FIRST because we are going to rename them.
            # Logic: If source image matches "SourceProject_...", rename to "TargetProject_..."
            # Then check if THAT new name exists in target.

            source_name = self.metadata.project_name
            target_name = target_project.metadata.project_name

            # Helper to predict name
            def predict_name(img_ref) -> str | None:
                if pd.isna(img_ref): return None
                s_ref = str(img_ref).strip()
                if not s_ref or s_ref.lower() == 'nan': return None

                # If starts with source project name (case-insensitive check), replace it
                # Otherwise, PREPEND target project name to enforce convention

                # Check 1: Exact match start
                if s_ref.startswith(source_name):
                    return s_ref.replace(source_name, target_name, 1)

                # Check 2: Case-insensitive match start
                if s_ref.lower().startswith(source_name.lower()):
                    # Retrieve the actual prefix length and slice
                    old_len = len(source_name)
                    suffix = s_ref[old_len:]
                    # If there was a separator (e.g. _) make sure we don't double it or lose it
                    # But simple concatenation is safest: TargetName + suffix
                    return f"{target_name}{suffix}"

                # Check 3: Force Prepend (if not already starting with target name)
                # If the image doesn't have the source prefix, the user wants it renamed to the new project.
                # e.g. "Cam1.jpg" -> "TargetProject_Cam1.jpg"
                if not s_ref.startswith(target_name):
                     return f"{target_name}_{s_ref}"

                return s_ref


            if "Image Reference" in target_geo.columns:
                # Identify images to replace (using PREDICTED names)
                img_refs_to_replace = set()
                for _, row in subset_geo.iterrows():
                    ref = row.get("Image Reference")
                    predicted = predict_name(ref)
                    if predicted:
                        img_refs_to_replace.add(predicted)

                if img_refs_to_replace:
                    # Find indices in target that match these images
                    # We iterate to find indices.
                    # Note: target_geo index should be RangeIndex 0..N usually
                    # Safe boolean mask: convert target column to string, but handle NaNs carefully
                    # We only care about rows where Image Ref is in our set.

                    # 1. Ensure target column is treated as string for comparison, but keep index alignment
                    target_refs = target_geo["Image Reference"].astype(str)

                    # 2. Check membership
                    mask = target_refs.isin(img_refs_to_replace)
                    indices_to_delete = target_geo[mask].index.tolist()

                    if indices_to_delete:
                        # Batch delete them from target
                        target_project.delete_segments(indices_to_delete)
                        # Reload target_geo as it has changed
                        # Actually delete_segments modifies df in place (or reassigns it)
                        # But we should rely on the object state update.

        # 2. Copy Images
        # Target Image Directory
        target_img_dir = target_project.project_path / global_var.PROJECT_IMAGES_FOLDER
        if not target_img_dir.exists():
            target_img_dir.mkdir(parents=True, exist_ok=True)

        source_name = self.metadata.project_name
        target_name = target_project.metadata.project_name

        for idx, row in subset_geo.iterrows():
            img_ref = None
            col_name_found = None
            for col in ["Image Reference", "image", "img"]:
                if col in row and pd.notna(row[col]):
                    val = str(row[col]).strip()
                    if val and val.lower() != 'nan':
                        img_ref = val
                        col_name_found = col
                        break

            if img_ref:
                # Calculate new name using robust logic
                new_img_ref = img_ref

                # Check 1: Exact
                if img_ref.startswith(source_name):
                    new_img_ref = img_ref.replace(source_name, target_name, 1)
                # Check 2: Case insensitive
                elif img_ref.lower().startswith(source_name.lower()):
                    old_len = len(source_name)
                    suffix = img_ref[old_len:]
                    new_img_ref = f"{target_name}{suffix}"
                # Check 3: Force Prepend (if not already starting with target name)
                elif not img_ref.startswith(target_name):
                     new_img_ref = f"{target_name}_{img_ref}"

                # Update the dataframe (subset_geo) with the new name
                # This ensures when we append below, it has the correct reference
                subset_geo.at[idx, col_name_found] = new_img_ref
                # Also update treatment/results if they have the column?
                # (Treatment has ImageReference, Results usually only lat/lon/scores)

                # Check treatment df
                if not subset_treat.empty and idx < len(subset_treat) and "Image Reference" in subset_treat.columns:
                     subset_treat.at[idx, "Image Reference"] = new_img_ref

                source_img_path = self.project_path / global_var.PROJECT_IMAGES_FOLDER / img_ref
                if source_img_path.exists():
                    target_img_path = target_img_dir / new_img_ref
                    materialize_project_image(source_img_path, target_img_path)


        # 3. Append to Target Project
        # Append GeoData
        if target_project.geo_data.df is None or target_project.geo_data.df.empty:
             target_project.geo_data.df = subset_geo
        else:
             target_project.geo_data.df = pd.concat([target_project.geo_data.df, subset_geo], ignore_index=True)
        target_project.geo_data.df_dirty = True

        # Append Attributes
        if target_project.latest().attributes.df is None or target_project.latest().attributes.df.empty:
            target_project.latest().attributes.df = subset_attr
        else:
            target_project.latest().attributes.df = pd.concat([target_project.latest().attributes.df, subset_attr], ignore_index=True)
        target_project.latest().attributes.df_dirty = True

        # Append Results
        if target_project.latest().results.df is None or target_project.latest().results.df.empty:
            target_project.latest().results.df = subset_res
        else:
            target_project.latest().results.df = pd.concat([target_project.latest().results.df, subset_res], ignore_index=True)
        target_project.latest().results.df_dirty = True

        # Append Treatment
        if target_project.latest().treatment.df is None or target_project.latest().treatment.df.empty:
            target_project.latest().treatment.df = subset_treat
        else:
            target_project.latest().treatment.df = pd.concat([target_project.latest().treatment.df, subset_treat], ignore_index=True)
        target_project.latest().treatment.df_dirty = True

        # 4. Update Target Metadata
        count_added = len(valid_indices)
        if target_project.metadata.size is None:
             target_project.metadata.size = 0
        target_project.metadata.size += count_added
        target_project.metadata.last_updated = datetime.datetime.now()

        # Save Target
        target_project.save_all()
        target_project.metadata.serialize(target_project.project_path)
        return count_added
        # ================================
        # Get dataframes to filter
        # ================================
        attr_df = self.latest().attributes.df
        treatment_df = self.latest().treatment.df
        results_df = self.latest().results.df
        geo_df = self.geo_data.df

        # ================================
        # Apply filters (AND logic between groups)
        # ================================

        # Start with all True masks
        attr_mask = pd.Series([True] * len(attr_df))
        treat_mask = pd.Series([True] * len(treatment_df))
        result_mask = pd.Series([True] * len(results_df))

        def map_labels_to_values(labels, value_map: dict) -> list:
            """Helper to normalize single/multi inputs and map to stored values."""
            if not labels:
                return []
            label_list = labels if isinstance(labels, list) else [labels]
            return [value_map[label] for label in label_list if label in value_map]

        # === Filter attributes (OR per field) ===
        for field, labels in filter_attributes.items():
            if labels:
                value_map = serializer.Attributes.CHOICES.get(field, {})
                mapped_values = map_labels_to_values(labels, value_map)
                attr_mask &= attr_df[field].isin(mapped_values)

        # === TODO Filter treatment ===
        for field_key, values in filter_treatment.items():
            field_name = getattr(serializer.Treatment.Fields, field_key, None)
            if field_name and values:
                treat_mask &= treatment_df[field_name].isin(values)

        # === Filter results ===
        for field, labels in filter_results.items():
            if labels:
                if field in serializer.Results.FIELDS_META:
                    value_map = serializer.Results.FIELDS_META[field]
                    mapped_values = map_labels_to_values(labels, value_map)
                else:
                    mapped_values = labels if isinstance(labels, list) else [labels]

                result_mask &= results_df[field].isin(mapped_values)

        # ================================
        # Combine masks with AND across datasets
        # ================================
        combined_mask = attr_mask & result_mask
        selected_indexes = combined_mask[combined_mask].index

        # ================================
        # Package filtered data
        # ================================
        filtered_project = Project()  # No path needed for in-memory filtered version

        # Attributes
        filtered_project.latest()._attributes = serializer.Attributes()
        filtered_project.latest().attributes.df = attr_df.loc[selected_indexes].reset_index(drop=True)

        # Treatment
        filtered_project.latest()._treatment = serializer.Treatment()
        filtered_project.latest().treatment.df = treatment_df
        # filtered_project.latest()._treatment._df = treatment_df.loc[selected_indexes].reset_index(drop=True)

        # Results
        filtered_project.latest()._results = serializer.Results()
        filtered_project.latest().results.df = results_df.loc[selected_indexes].reset_index(drop=True)

        # Geo data
        filtered_project._geo_data = serializer.ProjectGeoData()
        filtered_project.geo_data.df = geo_df.loc[selected_indexes].reset_index(drop=True)
        filtered_project.geo_data.df = filtered_project.geo_data.df.set_geometry("geometry")

        # Metadata
        filtered_project.metadata = self.metadata  # Optionally deepcopy or set as-is

        return filtered_project

    # ─── Project-level metadata (non-versioned) ───────────────
    @property
    def metadata(self) -> serializer.ProjectMetadata:
        if self._metadata is None:
            meta = serializer.ProjectMetadata()
            try:
                meta.parse(self.project_path / "project_metadata.json")
            except (FileNotFoundError, ValueError):
                # Fallback for corrupt/incomplete projects
                print(f"Warning: Could not read metadata for {self.project_path.name}")
                meta.project_name = self.project_path.name
            self._metadata = meta
        return self._metadata

    @metadata.setter
    def metadata(self, value: serializer.ProjectMetadata) -> None:
        if not isinstance(value, serializer.ProjectMetadata):
            raise TypeError("metadata must be serializer.ProjectMetadata")
        self._metadata = value
        self._meta_dirty = True

    @property
    def geo_data(self) -> serializer.ProjectGeoData:
        if self._geo_data is None:
            geo_tbl = serializer.ProjectGeoData()
            geo_tbl.parse(self.project_path)
            self._geo_data = geo_tbl
        return self._geo_data

    @geo_data.setter
    def geo_data(self, value: serializer.ProjectGeoData) -> None:
        if not isinstance(value, serializer.ProjectGeoData):
            raise TypeError("metadata must be serializer.ProjectGeodata")
        self._geo_data = value
        self._geo_dirty = True
