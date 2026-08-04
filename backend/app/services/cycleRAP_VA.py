#!/usr/bin/env python
# coding: utf-8

# # Project Details
# ---

# Connecting to local runtime in google colab
# 
# Paste the following command into the Jupyter CLI
# >  jupyter notebook \
#     --NotebookApp.allow_origin='https://colab.research.google.com' \
#     --port=8888 \
#     --NotebookApp.port_retries=0
# 
# Copy and paste backend URL (/w token) into google colab to connect

# [GPU testing](https://colab.research.google.com/notebooks/gpu.ipynb)

# TODO: Refactor file to be video_extraction.py

# # Project Configurables
# ---

# Developer
enable_print = False
folder_prefix = "Extracted_Frames" # to contatenate with _{video_name}


# ## Temporary hardcoded values

# Change to read from user input in future
hardcoded_csv_name = "TeleData39.csv"
hardcoded_video_filename = "Footage39.MP4"


# # Libraries
# ---
# Packages to install
# !pip install opencv-python
# !pip install geopandas
# !pip install geopy
# !pip install folium matplotlib mapclassify
# !pip install openpyxl
import cv2
import os 
import shutil
import pandas as pd
import geopy.distance
import geopandas as gpd
from shapely.geometry import LineString, Point
import numpy as np
import math
from glob import glob
from pathlib import Path
from app.services.cycle_rap_processing_gopro_footage import gdfify, extractGPS, extractSpeed, getDuration, geoCode, snaptoLink, getTimestamp, calculate_average_time_difference

# from shapely.geometry import LineString, Point, shape, MultiLineString
#import folium
# import IPython.display as display
# import fiona
# import matplotlib.pyplot as plt

# from IPython.display import Video
#from folium import Map
# from ipyleaflet import Map, TileLayer, SplitMapControl, GeoJSON
# from IPython.display import IFrame


# # Image Extraction
# ---

# ### Video Image extraction
# 
# 1. Get telemetry data from GoPro
# 
# Extract data in CSV format for CycleRAP to read
# 
# 2. Extract image from video (FFmpeg/openCV)
# 
# Image interval of video calculated based on CycleRAP calculation spreadsheet (to be found)

# ## Functions

# Function to calculate distance between two GPS points
def calculate_distance(lat1, lon1, lat2, lon2):
    return geopy.distance.geodesic((lat1, lon1), (lat2, lon2)).meters


# Function to save a video frame
def save_frame(video, frame_number, image_index, output_dir, enable_print = False):
    # print(f"Saving frame: {frame_number}")
    video.set(cv2.CAP_PROP_POS_FRAMES, frame_number)
    success, frame = video.read()
    # print(f"save_frame success: {success}")
    if success:
        frame_filename = os.path.join(output_dir, f'{image_index}.jpg')
        cv2.imwrite(frame_filename, frame)
        if enable_print: print(f"Saved {image_index}.jpg of frame {frame_number}")
    else:
        if enable_print: print(f"Index {image_index} cannot be saved. Frame: {frame_number}")
    return success, image_index + 1

# Create folder to extract data (Will override existing directory)
def prepare_directory(output_dir_name, output_path = None) -> str:
    if output_path is None: full_path = get_full_path(output_dir_name)
    else: full_path = os.path.join(output_path, output_dir_name)
    if os.path.exists(full_path): shutil.rmtree(full_path)
    os.makedirs(full_path)
    return full_path

# Sum up the points within the dataframe to keep roughly one point every
# `min_distance` (default 10 m) of travel. A gap larger than min_distance + max
# is NOT discarded — the point is still kept as one longer segment so no road
# coverage is lost (this is what lets already-thinned folders, e.g. the installer
# seed data, still produce all their segments instead of ~half).
def get_geo_points_by_distance(original_geo_dataframe, min_distance = 10, max = 5):

    lat_df = original_geo_dataframe['geometry'].apply(lambda point: point.y)
    lon_df = original_geo_dataframe['geometry'].apply(lambda point: point.x)

    # Initialize variables
    last_lat = lat_df.iloc[0]
    last_lon = lon_df.iloc[0]
    accumulated_distance = 0
    geo_dataframe = pd.DataFrame()
    initial_entry = pd.DataFrame([original_geo_dataframe.iloc[0]])

    # Iterate through telemetry data
    for index, row in original_geo_dataframe.iloc[1:].iterrows():
        current_lon = lon_df.iloc[index]
        current_lat = lat_df.iloc[index]

        distance = calculate_distance(last_lat, last_lon, current_lat, current_lon)
        # Acculumative distance traveled
        accumulated_distance += distance
        # print(f"distance to add: {distance}")
        if accumulated_distance < min_distance:
            # Too close to the last kept point to start a new ~10 m segment. Keep
            # accumulating. On dense surveys this is what enforces the intended
            # ~1-point-per-10 m spacing; on already-thinned folders (points spaced
            # >= 10 m) it never triggers, so every point is used.
            last_lat, last_lon = current_lat, current_lon
            continue

        # Far enough to anchor a new segment. Always KEEP the point — never discard
        # it for being "too far". A gap beyond (min_distance + max) simply becomes
        # one longer segment rather than a hole in the coverage.
        if geo_dataframe.empty:
            geo_dataframe = initial_entry

        # Save geo point
        geo_dataframe = pd.concat([geo_dataframe, pd.DataFrame([row])], ignore_index=True)

        # Reset accumulator, then set last location. A long gap resets fully so no
        # leftover residual cascades into dropping the next point; a normal gap
        # keeps the sub-min_distance remainder so spacing stays ~10 m on dense input.
        if accumulated_distance >= (max + min_distance):
            accumulated_distance = 0
        else:
            accumulated_distance -= min_distance
        last_lat, last_lon = current_lat, current_lon

    return geo_dataframe

def convert_points_to_linestrings(geo_dataframe):
    # At least two points to form a line
    if len(geo_dataframe) < 2:
        print("Not enough points to create line segments.")
        return None

    points = list(geo_dataframe.geometry)
    n = len(points)

    # Segments from consecutive points: P[i] -> P[i+1], anchored to P[i]. This alone
    # gives N-1 segments and leaves the LAST photo owning no segment (it is only the
    # end of the final pair). Append one more segment so every photo — including the
    # last — is its own full segment (N photos -> N segments). Downstream sizing keys
    # off row count (len(FILENAME)), so attributes/snapshot/scores scale automatically.
    lines = [LineString([points[i], points[i + 1]]) for i in range(n - 1)]

    # Final segment for the last photo. There is no photo after it, so continue the
    # last travel direction one step (mirror P[N-1]-P[N-2]) to give it a real length —
    # so gradient/curvature/width and all attributes apply to it exactly like every
    # other segment. The extrapolated end is NEVER drawn (every map/report/export plots
    # a segment as a point at its FIRST coordinate = the real last photo); it exists
    # only so the segment can be measured. Degenerate guard: identical final points
    # (zero delta) fall back to a zero-length segment at the last photo.
    last, prev = points[n - 1], points[n - 2]
    dx, dy = last.x - prev.x, last.y - prev.y
    extrapolated_end = last if (dx == 0 and dy == 0) else Point(last.x + dx, last.y + dy)
    lines.append(LineString([last, extrapolated_end]))

    point_start = points                              # all N points (each segment's anchor)
    point_end = points[1:] + [extrapolated_end]       # P[1..N-1] then the extrapolated end

    # Create a new GeoDataFrame with LineString geometries
    line_gdf = gpd.GeoDataFrame(
        {'point_start': point_start,
         'point_end': point_end,
         'geometry': lines},
        crs=geo_dataframe.crs  # Maintain the same coordinate reference system
    )

    if 'ELAPSED_TIME' in geo_dataframe.columns:
        line_gdf['ELAPSED_TIME'] = geo_dataframe['ELAPSED_TIME'].values

    if 'FILENAME' in geo_dataframe.columns:
        line_gdf['FILENAME'] = geo_dataframe['FILENAME'].values

    return line_gdf

# NOTE: ONLY VIDEO EXTRACTION REQUIRES ELAPSED TIME FOR FRAME EXTRACTION
def extract_frames_to_path(video_file_path, frames_to_extract_df, path_to_save_images_to, enable_print = False):
    video = cv2.VideoCapture(video_file_path)

    if enable_print is True: print(f"Total frames: {video.get(cv2.CAP_PROP_FRAME_COUNT)}")

    # Check if video was successfully opened
    if not video.isOpened():
        assert False, f"{video_file_path} cannot be loaded"
        print(f"Error: Could not open video file {video_filename}")
    elif enable_print: print(f"Video {video_file_path} successfully loaded.")

    success = False
    image_index = 1
    frame_number = 1
    frame_rate = video.get(cv2.CAP_PROP_FPS)

    for index, row in frames_to_extract_df.iloc[0:].iterrows():
        elapsed_time_in_seconds = row['ELAPSED_TIME']
        # Calculate the corresponding frame number
        frame_number = math.floor(elapsed_time_in_seconds * frame_rate) # Concern: may have very very small desync between image and geo data points due to rounding
        success, image_index = save_frame(video, frame_number, image_index, path_to_save_images_to, enable_print)
        if not success: break
    
    return success

# DEPRECATED, THIS METHOD IS TRYING TO DO TOO MANY THINGS AT THE SAME TIME
# INSTEAD REFER TO: get_geo_points_by_distance()
# Full image extraction operation
# Returns 1 on success
def extract_images_distance(video_filename, telemetry_dataframe, distance_to_capture, directory_name = None, directory_path = None, enable_print = False):
    telemetry_dataframe = telemetry_dataframe.reset_index(drop=True)

    # Open the video file
    video_name = Path(video_filename).stem
    video = cv2.VideoCapture(video_filename)
    # Check if video was successfully opened
    if not video.isOpened():
        assert False, "Video cannot be loaded"
        print(f"Error: Could not open video file {video_filename}")
    elif enable_print: print(f"Video {video_filename} successfully loaded.")
    
    # Create folder to extract data (Will override existing directory)
    if directory_name is None: directory_name = video_name
    output_dir = prepare_directory(directory_name, directory_path)

    lat_df = telemetry_dataframe['geometry'].apply(lambda point: point.y)
    lon_df = telemetry_dataframe['geometry'].apply(lambda point: point.x)

    # Initialize variables
    last_lat = lat_df.iloc[0]
    last_lon = lon_df.iloc[0]
    accumulated_distance = 0
    image_index = 1
    frame_number = 1
    frame_rate = video.get(cv2.CAP_PROP_FPS)
    
    # Creating new list to hold corresponding telemetry data to captured images
    new_csv_data = []

    # print("SAVING FIRST FRAME")

    # Save first frame
    success, image_index = save_frame(video, frame_number, image_index, output_dir)
    if success: new_csv_data.append(telemetry_dataframe.iloc[0])
    else:
        if enable_print: print(f'Fail to save first frame, exiting...')
        return 0
    
    # print("FINISHED SAVING FIRST FRAME")
    # print("START ITERATION")

    # Iterate through telemetry data
    for index, row in telemetry_dataframe.iloc[1:].iterrows():
        # if row['GPS (2D) [m/s]'] < 0.1: continue # This line is to speed up the process by skipping entries where the cyclist isn't moving but can be removed for better accuracy
        # print(f"== ITERATION {index} ==")
        current_lon = lon_df.iloc[index]
        current_lat = lat_df.iloc[index]
        elapsed_time_in_seconds = row['ELAPSED_TIME']
        # print(f"Elapsed time in seconds: {elapsed_time_in_seconds}")
    
        # print("Begin distance calculation")
        # Calculate distance traveled since the last point
        distance = calculate_distance(last_lat, last_lon, current_lat, current_lon)
        # print(f"End distance calculation: {distance}")

        # print("Begin accumulated distance calc")
        # Acculumative distance traveled
        accumulated_distance += distance
        if accumulated_distance < distance_to_capture: 
            last_lat, last_lon = current_lat, current_lon
            continue
        # print(f"End accumulated distance calc: {accumulated_distance}")
        
        # Calculate the corresponding frame number
        frame_number = round(elapsed_time_in_seconds * frame_rate) # Concern: may have very very small desync between video and CSV file due to rounding

        success, image_index = save_frame(video, frame_number, image_index, output_dir)
        # print(f"SUCCESS IS {success}")
        if success: new_csv_data.append(row)
        else: 
            if enable_print: 
                print(f'Fail to append new row, exiting...')
            break
        
        # Reset the accumulated distance and set last location
        accumulated_distance -= distance_to_capture
        last_lat, last_lon = current_lat, current_lon
    # print("FINISH ITERATION")
    # Release the video
    video.release()
    
    # Creating the new CSV file
    new_csv_filename = os.path.join(directory_path, 'image_data.csv') # TODO change the string literal to a constant val
    new_csv_df = pd.DataFrame(new_csv_data)
    new_csv_df.to_csv(new_csv_filename, index = False)
    if enable_print: print(f'Image extraction complete, new CSV saved: \\{new_csv_filename}')

    return new_csv_df

def extract_images_interval(video_filename, interval_ms): # interval in milliseconds
    # Open the video file
    video_name = Path(video_filename).stem
    video = cv2.VideoCapture(video_filename)
    assert video is not None, "Video cannot be loaded"
    
    # Create folder to extract data (Will override existing directory)
    output_dir = prepare_directory(video_name)

    image_index = 1
    frame_number = 1
    frame_rate = video.get(cv2.CAP_PROP_FPS)
    frame_interval = int((interval_ms / 1000) * frame_rate)
    
    while True:
        video.set(cv2.CAP_PROP_POS_FRAMES, frame_number)
        success, image_index = save_frame(video, frame_number, image_index, output_dir)
        
        if not success:
            break  # Exit when no frames are left
        
        # Increment frame_number by the frame interval
        frame_number += frame_interval

    # Release the video
    video.release()


def create_video(image_dir, video_name, fps):
    # Sort the images in the right order (dependent on name)
    image_paths = sorted(glob(os.path.join(image_dir, '*.jpg')))  # Adjust extension if needed
    
    # Read the first image to get frame dimensions
    frame = cv2.imread(image_paths[0])
    height, width, layers = frame.shape
    
    fourcc = cv2.VideoWriter_fourcc(*'XVID')  # ChatGPT suggested XVID, I'm not sure about other codecs
    video = cv2.VideoWriter(video_name, fourcc, fps, (width, height))
    
    # Loop through images and write them to the video
    for image_path in image_paths:
        frame = cv2.imread(image_path)
        video.write(frame)  # Write out frame to video
    
    # Release the video writer
    video.release()
    
    print(f'Video saved as {video_name}')


# # Computer Vision
# ---

# Model: YOLO V8 
# 
# Types: Instance segmentation, classification, object detection
# from roboflow import Roboflow
# rf = Roboflow(api_key="kYNapiJH1dI3tYuK6d5D")
# project = rf.workspace("a-workspace").project("pathways")
# version = project.version(6)
# dataset = version.download("yolov8")import os
# os.environ['KMP_DUPLICATE_LIB_OK'] = 'TRUE'!yolo task=segment mode=train model=C:\Users\mokch\GitProjects\CycleRAPResearch\yolov8n-road-segmentation-driving-pov-v4.pt data=C:\Users\mokch\GitProjects\CycleRAPResearch\Pathways-6\data.yaml epochs=11 imgsz=640 plots=True!yolo task=segment mode=train model=C:/Users/mokch/GitProjects/CycleRAPResearch/runs/segment/transfer_train3/weights/best.pt data=C:/Users/mokch/GitProjects/CycleRAPResearch/Pathways-6/data.yaml epochs=11 imgsz=640 plots=True!yolo task=segment mode=predict model=C:/Users/mokch/GitProjects/CycleRAPResearch/runs/segment/transfer_train3/weights/best.pt source=C:\Users\mokch\GitProjects\CycleRAPResearch\CFM_Vid
# # CycleRAP
# ---

# ## Automatic Coding

# ## CycleRAP Assessment

# # Main
# ---

# def visualize_geological_map_points(csv_file_path, shp_file_path=None):
#     # Load CSV data
#     data = pd.read_csv(csv_file_path)
    
#     # Extract relevant columns for GPS coordinates
#     latitude = data['GPS (Lat.) [deg]']
#     longitude = data['GPS (Long.) [deg]']
    
#     # Create a GeoDataFrame from the CSV data
#     gdf_points = gpd.GeoDataFrame(data, geometry=gpd.points_from_xy(longitude, latitude))
    
#     if shp_file_path and os.path.exists(shp_file_path):
#         # Load the shapefile (path layer)
#         path_layer = gpd.read_file(shp_file_path)
        
#         # Snap points to the nearest path in the shapefile
#         gdf_points['geometry'] = gdf_points.geometry.apply(lambda point: path_layer.geometry[path_layer.distance(point).idxmin()])
    
#     # Create a base map centered at the mean latitude and longitude
#     map_center = [latitude.mean(), longitude.mean()]
#     geological_map = folium.Map(location=map_center, zoom_start=15)
    
#     # Add markers for each GPS point
#     for point in gdf_points.geometry:
#         folium.Marker(location=[point.y, point.x]).add_to(geological_map)
    
#     return geological_map

# def visualize_geological_map_lines(csv_file_path, shp_file_path=None):
#     # Load CSV data
#     data = pd.read_csv(csv_file_path)
    
#     # Extract relevant columns for GPS coordinates
#     latitude = data['GPS (Lat.) [deg]']
#     longitude = data['GPS (Long.) [deg]']
    
#     # Create a GeoDataFrame from the CSV data
#     gdf_points = gpd.GeoDataFrame(data, geometry=gpd.points_from_xy(longitude, latitude))
    
#     if shp_file_path and os.path.exists(shp_file_path):
#         # Load the shapefile (path layer)
#         path_layer = gpd.read_file(shp_file_path)
        
#         # Snap points to the nearest path in the shapefile
#         gdf_points['geometry'] = gdf_points.geometry.apply(lambda point: path_layer.geometry[path_layer.distance(point).idxmin()].interpolate(0.5) if isinstance(path_layer.geometry[path_layer.distance(point).idxmin()], LineString) else point)
    
#     # Create a base map centered at the mean latitude and longitude
#     map_center = [latitude.mean(), longitude.mean()]
#     geological_map = folium.Map(location=map_center, zoom_start=100)
    
#     # Draw a line along the points to visualize the path
#     line_coords = [(point.y, point.x) for point in gdf_points.geometry if isinstance(point, Point)]
#     folium.PolyLine(line_coords, color='blue').add_to(geological_map)
    
#     return geological_map

# def notebook_display_map(csv_file_path, shp_file_path=None, display_type='points'):
#     if display_type == 'lines':
#         geological_map = visualize_geological_map_lines(csv_file_path, shp_file_path)
#     else:
#         geological_map = visualize_geological_map_points(csv_file_path, shp_file_path)
    
#     map_file = 'geological_map.html'
#     geological_map.save(map_file)
#     display.display(IFrame(map_file, width='100%', height='500'))

# TODO: Move to Utility
def get_full_path(filename: str) -> str:
    """Return an absolute path for a file located in the backend/ directory.

    The canonical config file is ``backend/config.json``; it is the only copy
    in the repo and is always resolved here rather than from the repository root.
    Docker copies ``backend/`` to ``/app/``, so the container reads
    ``/app/config.json`` via the same resolution.

    Args:
        filename: A filename or relative path to resolve under the backend root.

    Returns:
        Absolute path string (``<repo>/backend/<filename>``).
    """
    backend_root = Path(__file__).resolve().parents[2]  # .../backend/
    return str(backend_root / filename)

# if __name__ == "__main__":
#     import win32com.client as win32

#     # Load CSV into DataFrame
#     df = pd.read_excel('C:/Users/mokch/Downloads/test.xlsm', sheet_name='Upload_data', engine='openpyxl')

#     # TODO: Edit DataFrame values here
#     print(df)

#     # Open Excel application
#     excel = win32.Dispatch('Excel.Application')

#     # Optional: Make Excel visible if you want to see the execution
#     excel.Visible = True

#     # Open the workbook (Make sure to use the full path)
#     workbook = excel.Workbooks.Open(r'C:/Users/mokch/Downloads/test.xlsm')

#     # TODO: Write DataFrame back into sheet

#     # Run the macro (Use the macro's full name including the module if necessary)
#     excel.Application.Run('CalculateResults.CalculateResults')

#     # Save the workbook (if the macro modifies the workbook)
#     workbook.Save()

#     # Close the workbook and quit Excel
#     workbook.Close()
#     excel.Application.Quit()

#     # Settings
#     ## SET TILESET
#     cdb = 'CartoDB Positron'
#     ## SET VIDEO NAME
#     video_name = 'Footage39.MP4'

#     # Path to the shapefile
#     shapefile_path = get_full_path("CyclingPath_Jul2024/Existing_cycling_paths.shp")
#     gdf_cp = gdfify(gpd.read_file(shapefile_path)[['geometry']])

#     # Extract video metadata
#     video_filepath = get_full_path(video_name)
#     df = extractGPS(video_filepath)
#     sdf = extractSpeed(video_filepath)
#     sdf.loc[-1] = [0]
#     sdf.index = sdf.index + 1

#     # Concatenate the dataframes along the axis=1
#     merged_df = pd.concat([df, sdf], axis=1)

#     avg_time_diff, frequency = calculate_average_time_difference(getTimestamp(video_filepath))

#     # Recalculate elapsed times using these updated values
#     scaling_factor = 10
#     merged_df['ELAPSED_TIME_AVG_DIFF'] = np.zeros(len(merged_df))
#     merged_df['ELAPSED_TIME_AVG_DIFF'] = np.arange(len(merged_df)) * avg_time_diff / scaling_factor

#     # GEOCODE RAW DATAFRAME
#     merged_df = geoCode(merged_df)
#     # Display raw cycling path
#     ### Plot the data
#     fig, ax = plt.subplots(figsize=(10, 10))  # Adjust figure size
#     merged_df.plot(ax=ax, edgecolor='blue', linewidth=1)
#     ax.set_title('Cycling Path Network')
#     plt.xlabel('Longitude')
#     plt.ylabel('Latitude')
#     plt.show()


#     # Option 1: Snap after processing
#     ## Get images from every 10m
#     option_1_df = extract_images_distance(video_name, merged_df, 10)

#     ## Display cyclist path
#     option_1_df = gdfify(option_1_df)

#     ## Display new cyclist path
#     ### Increase the figure size to ensure geometries are visible
#     fig, ax = plt.subplots(figsize=(10, 10))  # Adjust figure size

#     ### Plot the data
#     option_1_df.plot(ax=ax, edgecolor='blue', linewidth=1)

#     ax.set_title('Cycling Path Network')
#     plt.xlabel('Longitude')
#     plt.ylabel('Latitude')
#     plt.show()

#     ### Apply path snapping to cyclist path
#     gdf_snapped = snaptoLink(raw = option_1_df, link = gdf_cp)
#     gdf_snapped = gdf_snapped.to_crs(epsg=4326)

#     ### Plot the data
#     fig, ax = plt.subplots(figsize=(10, 10))  # Adjust figure size
#     gdf_snapped.plot(ax=ax, edgecolor='blue', linewidth=1)

#     ax.set_title('Cycling Path Network')
#     plt.xlabel('Longitude')
#     plt.ylabel('Latitude')
#     plt.show()


#     # Option 2: Snap before processing
#     ## Apply path snapping to cyclist path
#     option_2_gdf_snapped = snaptoLink(raw = merged_df, link = gdf_cp)
#     option_2_gdf_snapped = option_2_gdf_snapped.to_crs(epsg=4326)

#     ## Display new cyclist path
#     ### Plot the data
#     fig, ax = plt.subplots(figsize=(10, 10))  # Adjust figure size
#     option_2_gdf_snapped.plot(ax=ax, edgecolor='blue', linewidth=1)
#     ax.set_title('Cycling Path Network')
#     plt.xlabel('Longitude')
#     plt.ylabel('Latitude')
#     plt.show()

#     ## Get images from every 10m
#     option_2_df = extract_images_distance(video_name, option_2_gdf_snapped, 10)
#     option_2_df = gdfify(option_2_df)

#     ### Plot the data
#     fig, ax = plt.subplots(figsize=(10, 10))  # Adjust figure size
#     option_2_df.plot(ax=ax, edgecolor='blue', linewidth=1)
#     ax.set_title('Cycling Path Network')
#     plt.xlabel('Longitude')
#     plt.ylabel('Latitude')
#     plt.show()