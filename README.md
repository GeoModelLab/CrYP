<div align="center">
  <img src="https://github.com/user-attachments/assets/3a191e37-5f47-43fb-a416-65f4488c7c2a" width="200">
</div>

# CrYP - Crop Yield Prediction GEE app

## Table of Contents

- [Introduction](#introduction)
- [Model Description](#model-description)
   - [Crop phenology and vegetation dynamic](#crop-phenology-and-vegetation-dynamic)
   - [Crop growth and yield prediction](#crop-growth-and-yield-prediction)
   - [Biomass and Yield Formation](#biomass-and-yield-formation)
- [CrYP Interface and Usage](#cryp-interface-and-usage)
- [Case Studies](#case-studies)
- [License](#license)

---

## Introduction
CrYP (Crop Yield Prediction) is an open-source tool designed for pixel-level crop yield forecasting over large regions. CrYP operates within the Google Earth Engine (GEE) platform (https://earthengine.google.com/), utilizing a simple crop model executed at run-time over geographic areas. The app uses weather data from ERA5-Land and vegetation data from the MODIS Normalized Difference Vegetation Index.

CrYP introduces a new approach for crop yield forecasting by incorporating real-time observed phenology into simple algorithms reproducing crop physiology.

The paper presenting CrYP is currently under review and its DOI will be available shortly.

---

## Model Description

### Crop phenology and vegetation dynamic
The seasonal MODIS-NDVI profile for each pixel, aligned with the crop calendar, is linearly interpolated to derive the daily time series, which is then used to identify key phenological metrics:
 - Crop Window Start (CWS): defined as the point when the 10-day moving average of the mean temperature in the first soil layer (0-7 cm, T_mean10, °C) exceeded a crop-specific temperature threshold;
 - Crop Window End   (CWE): corresponds to the harvest DOY, which is either set when the NDVI falls below the NDVI at sowing or on the last day of the crop calendar;
 - Start of Season   (SOS): defined as the DOY when NDVI reaches 20% of its peak value;
 - Peak  of Season   (POS): defined as the DOY when the maximum NDVI is reached;
 - End   of Season   (EOS): defined as the DOY when NDVI drop below 20% of its peak value.

Afterwards, the NDVI profile is resized according to CWS and CWE. To modulate the intensity of soil water content variations and light interception, NDVI is transformed into fractional vegetation cover (FVC) through the following generalized function:

$$
FVC_i = \frac{NDVI_i - NDVI_{sow}}{NDVI_{flo} - NDVI_{sow}}
$$

where:  
- FVC_i = Fractional vegetation cover at the i-th date
- NDVI_i = is the NDVI at the i-th composite date  
- NDVI_flo = is the NDVI value at POS
- NDVI_sow = is the NDVI value at CWS

FVC is used to derive the Leaf Area Index (LAI) dynamics. First, NDVI_flo is converted to LAI_flo using NDVI-LAI conversion equations specific to maize (Eq. 1) and winter crops (barley and wheat) (Eq. 2):  

Eq. 1:

$$
LAI_{flo} = (NDVI_{flo} \times 8.553) - 0.054
$$  

Eq. 2:

$$
LAI_{flo} = \frac{\log{((1 - NDVI_{flo}) / 1.0866)}}{3.379} \div (-0.3994)
$$  

where LAI_flo is the LAI at POS.  

Then, the time series of LAI is computed as:  

$$
LAI_i = FVC_i \times LAI_{flo}
$$  

where LAI_i is the LAI at the i-th composite date.  

### Crop growth and yield prediction
The effect of daily average temperature (f_temp, unitless, range: 0–1, Eq. 3), as well as the impact of cold stress (f_cold, unitless, Eq. 4) and heat stress (f_heat, unitless, Eq. 5), on daily photosynthetic rates is computed using T_mean, T_min, and T_max as inputs. These are processed through a response function driven by crop-specific cardinal temperatures.  

Eq. 3:

$$
f_{temp} = \left( \frac{T_{max} - T_{mean}}{T_{max} - T_{opt}} \right) 
\times \left( \frac{T_{mean} - T_{base}}{T_{opt} - T_{base}} \right)^{\frac{T_{opt} - T_{base}}{T_{max} - T_{opt}}}
$$  

where:  
- T_mean = daily mean temperature  
- T_base = crop-specific base temperature  
- T_max  = crop-specific maximum temperature  
- T_opt  = crop-specific optimal temperature  

Eq. 4:

$$
f_{cold} =
\begin{cases} 
1, & T_{min} \geq T_{cold} \\  
1 - \frac{T_{cold} - T_{min}}{T_{cold} - T_{extC}}, & T_{extC} < T_{min} \leq T_{cold} \\  
0, & T_{min} < T_{extC}  
\end{cases}
$$  

where:  
- T_cold = threshold for cold stress  
- T_extC = extreme cold temperature  

Eq. 5:

$$
f_{heat} =
\begin{cases} 
1, & T_{max} \leq T_{heat} \\  
1 - \frac{T_{max} - T_{heat}}{T_{extH} - T_{heat}}, & T_{heat} < T_{max} \leq T_{extH} \\  
0, & T_{max} > T_{extH}  
\end{cases}
$$  

where:  
- T_heat = threshold for heat stress  
- T_extH = extreme heat temperature  


The effect of soil water stress on photosynthesis is computed using the 15-day rolling sum of precipitation (water supply) and evapotranspiration (crop water demand) as inputs. The soil water stress coefficient (RSWC, unitless, range: 0–1, Eq. 6) is derived by weighting the precipitation-to-evapotranspiration ratio (AW, unitless, range: 0–1, Eq. 7), which is scaled by the vegetation (FVC) and soil cover (1 - FVC) fractions.  

Eq. 6:

$$
RSWC = FVC \times (0.5 + 0.5 \times AW) + (1 - FVC) \times AW
$$  

Eq. 7: 

$$
AW = \frac{\sum P}{\sum ETo}
$$  

where:  
- P = precipitation  
- ETo = evapotranspiration  

The daily photosynthetic rate (Ph, Eq. 8) is simulated considering the intercepted radiation using the simulated LAI:  

Eq. 8:

$$
Ph_i = Rad \times 0.5 \times \left[1 - \exp(-k \times LAI)\right] \times RUE \times f_{temp} \times f_{stress}
$$  

where:  
- Rad = global solar radiation (MJ m\(^{-2}\) d\(^{-1}\))  
- 0.5 = fraction of photosynthetically active radiation  
- RUE = radiation use efficiency (g MJ\(^{-1}\), Monteith 1965)  
- f_stress = cold, heat, or water stress factor (f_stress = 0 for maximum impact)  

In the potential production level, f_stress is set to 1, and users can activate specific stresses via the CrYP app.  


### Biomass and Yield Formation 
The cumulative aboveground biomass (Bio, Eq. 9) is derived by integrating Ph daily: 

Eq. 9: 

$$
Bio = \sum_{CWS}^{CWE} Ph_i
$$  

Yield (Y, Eq. 10) is computed by integrating Ph_i daily, starting from the day after flowering (POS), while considering the remobilization of a fraction of Bio to storage organs:  

Eq. 10:

$$
Y = \sum_{POS}^{CWE} Ph_i + (Bio_{POS} \times Rc) \times 0.01
$$  

where:  
- Bio_POS = biomass at flowering stage  
- Rc = carbohydrate remobilization coefficient  
- 0.01 = conversion factor from g m\(^{-2}\) to Mg ha\(^{-1}\)

---

## CrYP Interface and Usage

<div align="center">
  <img src="https://github.com/user-attachments/assets/a83c9ad7-76ec-4891-8945-1c00501d6171" width="800">
</div>

⚠ **Note:** To use CrYP it is necessary to create a Google Earth Engine account, which can be done freely at: https://code.earthengine.google.com/register.  

CrYP app can be used through a practical graphical user interface (GUI) which will appear after running the script. The GUI consists of five main sections:

- **Section A**:

<div align="center">
  <img src="https://github.com/user-attachments/assets/bb69f7e1-8f37-4333-8814-2c642c817b53" width="600">
</div>

   1. Set the crop type (maize or winter cereals, representing wheat and barley);
   2. Set the production level (potential, cold-limited, heat-limited, or water-limited);

- **Section B**:

<div align="center">
  <img src="https://github.com/user-attachments/assets/3b07b869-5dcb-4add-92db-9ee7890a2844" width="600">
</div>

   3. Set the simulation year;
   4. Set the starting month of the growing season and its expected duration, according to the expert knowledge and/or crop calendars;

- **Section C**:

<div align="center">
  <img src="https://github.com/user-attachments/assets/38d9ed5b-80c6-41c6-bc92-a0e3b0081f32" width="600">
</div>

   5. Set the study area, either by drawing a geometry (polygon or point) on the map or by using vector data (shapefiles) from assets in the user's GEE          account. If you want to use a custom-made geometry, you need to draw it **before** running the script.

- **Section D**:

<div align="center">
  <img src="https://github.com/user-attachments/assets/464bc040-5e5c-433e-a0c0-30d8321e88a6" width="600">
</div>

   6. You can choose to use your own NDVI data by checking the box, providing the path to the asset folder of your GEE account and selecting the Image
      Collection from the dropbox list of the assets. Otherwise, the NDVI data will be computed "on-the-fly" for the study area defined in SectionA.

⚠ **Note**: We highly racommend to precompute NDVI data to prevent memory issues when working with large areas or long time series.

⚠  **Ensuring NDVI Data Compatibility**: We provide a GEE script to export NDVI data to your GEE assets in the correct format. This script allows users to:
a. Select the sensor type (currently supports MODIS); b. Define a time range and study area.; c. Generate an NDVI image collection for improved performance.

- **Section E**:

<div align="center">
  <img src="https://github.com/user-attachments/assets/aaa9b333-dcf3-4bef-b8c0-93f2b0e66dad" width="600">
</div>

  7. Customize model parameters, including:  
      - Crop-specific cardinal temperatures (base, optimum, maximum, and extreme temperature thresholds for crop growth).  
      - Radiation Use Efficiency (RUE, g MJ^-1).  
      - Light extinction coefficient (k, unitless).  
      - Remobilization coefficient (remob_coeff, unitless).  
      - Time window for calculating the rolling average of soil temperature to define the sowing day (\( moving\_wind \), number of days).  

   8. Click on the **run** button at the bottom of the GUI to start the simulation.

CrYP simulation results, including **phenological metrics and yield rasters**, can be exported to **Google Drive** in **GeoTIFF format** for further analysis. Exports can be started in the **export** tab.

⚠ **Storage Limitation**: Google Drive offers 15 GB of free storage. If your quota is exceeded, export tasks will fail unless you purchase additional storage.

---

## Case studies
CrYP has been applied on two proof-of-concepts, demonstrating its ability to capture spatial and temporal yield variability of winter and summer crops grown in contrasting environments: (i) maize (Zea mays L.) crop grown in the U.S. Corn Belt in 2012 and 2020, and (ii) wheat (Triticum aestivum L.) and barley (Hordeum vulgare L.) grown in the Piedmont and Apulia regions of Italy (NUTS-2) in 2018 and 2022, respectively. 

- IOWA case study

Maize cultivation in Iowa, one of the core areas of the US Corn Belt is mostly rainfed and constitutes 17-18% of the national production. 
The analysis was conducted for 2012, a year with exceptionally low yields due to frequent droughts and heat waves, and for 2020, i.e., as a reference for an average production year.

Simulated maize LAI dynamics and phenometrics (SOS, POS, and EOS) for the considered Iowa counties are presented below. In 2020, LAI values were consistently higher than in 2012, when severe drought and a heat wave significantly impacted crop growth. This resulted in a marked advancement of phenological stages in 2012 compared to 2020. 

<div align="center">
  <img src="https://github.com/user-attachments/assets/ff8f7fc6-dc22-4b0b-864d-37140dedc44e" width="600">
</div>

The impacts of drought and heat waves reflected also in the simulated yields:

<div align="center">
  <img src="https://github.com/user-attachments/assets/ea25b632-bfcf-46b1-a7bd-d68db9aceda3" width="600">
</div>

- Italy case study

In the second use case, we applied CrYP to two winter cereals in Italy, i.e., wheat in Piedmont and barley in Apulia. Here, the landscape is highly heterogeneous and characterized by relatively small fields. 

Here, CrYP succefully captured the phenology and yield variability:

<div align="center">
  <img src="https://github.com/user-attachments/assets/1ba8e773-0245-4e3c-a075-f7a7cfe02114" width="600">
</div>

---

## License
Attribution-NonCommercial-NoDerivatives 4.0 International
