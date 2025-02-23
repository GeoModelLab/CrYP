/**********************************************************************
The Crop Yield Prediction (CrYP) is an an open-source tool designed for 
pixel-level crop yield forecasting over large regions.

Attentions:
 - If you want to export the result for a very large area or for a high growing season
   lenght, better to export as asset the vegetation image collection and import it. 
   Otherwise, it will take a long time to processing or even failed.
   
 - We provide the following GEE script that exports NDVI data as an image collection
   directly to the user's GEE assets: https://code.earthengine.google.com/d0525c1f7ef950aa4fdd2afb36e02018
   
 - The maixum storage space provide by Google Drive with free account is 15 GB,
   please check your left space before exporting result.

Create date: 09/10/2024

Author: Dr. Crecco Lorenzo
Email: lorenzo.crecco@crea.gov.it
Council for Agricultural Research and Economics, Research Centre for Agriculture and Environment (CREA-AA), Italy 
**********************************************************************/

var run = function(){
  
      var AOI = CrYP_ui.AOI;
      print(AOI);
      
      // get Crop Variables (dict) and type
      var crop_type = CrYP_ui.crop.species; // maize or wheat
      print(CrYP_ui.crop.species);
      
      switch (crop_type) {
        
        case 'Winter crops':
          
          var crop_variables = {
              'crop_Tbase'     : CrYP_ui.model.Tbase     || ee.Image.constant(0), 
              'crop_Topt'      : CrYP_ui.model.Topt      || ee.Image.constant(20),
              'crop_Tmax'      : CrYP_ui.model.Tmax      || ee.Image.constant(30), 
              'crop_Text_heat' : CrYP_ui.model.Text_heat || ee.Image.constant(40),
              'crop_Text_cold' : CrYP_ui.model.Text_cold || ee.Image.constant(-5)
            };
          
          var RUE = CrYP_ui.model.RUE || 1.5;
          var k   = CrYP_ui.model.k   || 0.4;
          var coeff_rim = CrYP_ui.model.coeff_rim || 0.01;
          var NDVI_to_LAIexp = 'lai = (log((1 - ndvi / 1.0866) / 3.379)) / -0.3994';
          
          break;
        
        case 'Maize':
          
          var crop_variables = {
              'crop_Tbase'     : CrYP_ui.model.Tbase     || ee.Image.constant(8), 
              'crop_Topt'      : CrYP_ui.model.Topt      || ee.Image.constant(28),
              'crop_Tmax'      : CrYP_ui.model.Tmax      || ee.Image.constant(34), 
              'crop_Text_heat' : CrYP_ui.model.Text_heat || ee.Image.constant(37),
              'crop_Text_cold' : CrYP_ui.model.Text_cold || ee.Image.constant(0)
            };
          
          var RUE = CrYP_ui.model.RUE || 4;
          var k   = CrYP_ui.model.k   || 0.5;
          var coeff_rim = CrYP_ui.model.coeff_rim || 0.01;
          var NDVI_to_LAIexp = 'lai = (ndvi * 8.553) - 0.054';
          
          break;
      }
      print(NDVI_to_LAIexp);
      
      // get environmental conditions:
      var env = CrYP_ui.scenario; // opt ; hot ; cold ; dry
      
      // get REF_date  
      var moving_window = CrYP_ui.model.mov_win; // AWI needs to consider previous days.
      var num_months    = CrYP_ui.crop.extent; // maize: 6; wheat: 9. It can change according to crop and region.
      
      var ref_date   = ee.Date.fromYMD(CrYP_ui.crop.year, CrYP_ui.crop.month, 1);                   // for modis collection and outputs.
      var start_date = ref_date.advance(-1 * moving_window, "day");    // for ERA5 collection.
      var stop_date  = ref_date.advance(num_months, "month");
      
      // require functions
      var tools            = require('users/lcrecco94/app:tools_lib');
      var veg_functions    = require('users/lcrecco94/app:vegetation_lib');
      var stress_functions = require('users/lcrecco94/app:stress_lib');
      
      // *********************************************************
      
      // 1. Get ERA5 collection, stress and awi
      var weather_col = tools.get_WEATHER_variables(start_date, stop_date, AOI);
      var fTemp_col   = stress_functions.compute_fTemp(weather_col.select('T_avg'), crop_variables);
      var fHeat_col   = stress_functions.compute_fHeat(weather_col.select('T_max'), crop_variables);
      var fCold_col   = stress_functions.compute_fCold(weather_col.select('T_min'), crop_variables);
      
      var awi         = stress_functions.get_awi(weather_col.select(['Pot_evap_sum', 'Prec_tot']), moving_window);

      // *********************************************************
      // 2. get NDVI (MODIS)
      
      var NDVI_int = CrYP_ui.vegCollection || 'no_collection';

      if (NDVI_int === 'no_collection') {
        
          print('preparing Veg Collection on the fly...');
          
          // Get MODIS raw data
          var NDVI = veg_functions.get_vegetation(ref_date, stop_date, AOI);
          
          // Smooth the NDVI time series by the Savitzky–Golay filter
          var sg_filter = require('users/Yang_Chen/GF-SG:SG_filter_v1');
          var list_trend_sgCoeff = ee.List([-0.070588261,-0.011764720,0.038009040,0.078733027,0.11040724,0.13303168,0.14660634, 0.15113123,0.14660634,0.13303168,0.11040724,0.078733027,0.038009040,-0.011764720,-0.070588261]);   //suggested trend parameter:(7,7,0,2)
          var list_sg_coeff      = ee.List([0.034965038,-0.12820521,0.069930017,0.31468537,0.41724950,0.31468537, 0.069930017,-0.12820521,0.034965038]);   //suggested parameters of SG:(4,4,0,5)
          
          var mod_ndvi_sg = sg_filter.sg_filter_chen(NDVI, list_trend_sgCoeff, list_sg_coeff);
          var ndvi_sg = mod_ndvi_sg.map(function(img){
                                            return img.rename('ndvi').copyProperties(img, ['system:time_start']);
                                          });
    
          // Daily interpolation of NDVI-sg
          var frame  = 1; 
          var NDVI_int = tools.linearInterpolation(ndvi_sg, frame).map(function (img) {
            var img_noprop = img.multiply(1);
            return img_noprop.rename('ndvi').set('system:time_start', img.get("system:time_start"));
          });
      }
      
      NDVI_int = NDVI_int.filterDate(ref_date, stop_date).sort('system:time_start');
      
      // *********************************************************
      // 3. compute SGS with weather

      // A) SGS_weather
      var sowing_window = 7; // remind: cannot be higher than 'moving_window'!
      var days = weather_col.filterDate(ref_date.advance(-1 * sowing_window, 'day'), stop_date).aggregate_array("system:time_start");
      
      var ic_Tmin_soil = weather_col.select("T_min_soil");
      
      var ic_Tmin_mw = ee.ImageCollection.fromImages(days.slice(sowing_window).map(function(day) {
        var start = ee.Date(day).advance(-1 * sowing_window, 'day');
        var end   = ee.Date(day).advance(1, 'day'); // remind: stop date is not inclusive!
      
        var T_mw_avg =  ic_Tmin_soil
                            .filter(ee.Filter.date(start, end))
                            .mean();
      
        return T_mw_avg.rename('T_mw_avg').set("system:time_start", day);
      }));
      
      var SGS_temp = ic_Tmin_mw.map(function(img){
                                  var mask = img.select('T_mw_avg').gte(10);
                                  
                                  var date = ee.Date(img.get('system:time_start'));
                                  var dateImage = ee.Image.constant(date.millis()).rename(['timestamp']).toFloat();
      
                                  return dateImage.updateMask(mask).rename("timestamp");
                                }).min();
      // B) EGS Weather (with GDD)

      // !!! not yet implemented.
      
      // *********************************************************
      // 4. compute phenometrics

      // B) NDVI max (fioritura)
      
      function addDateBands (img) {
        var date = img.date();
        
        var dateImage_formatted = ee.Image.constant(ee.Number.parse(date.format("YYYYMMdd"))).int().rename("formatted");
        var dateImage_millis    = ee.Image.constant(date.millis()).toFloat().rename(['timestamp']);
        
        var doy                 = date.getRelative('day', 'year');
        var dateImage_doy       = ee.Image.constant(doy).add(ee.Image.constant(1)).int().rename(['doy']);
         
        return img.addBands(dateImage_millis).addBands(dateImage_formatted).addBands(dateImage_doy);
      }
      
      var NDVI_with_doy = NDVI_int.map(addDateBands);

      // (!!!) to avoid anomalies (like peak of ndvi at the end of crop season) filter the ic to skip last month (changed from: '.advance(5, 'month')')
      var maxNDVI = NDVI_with_doy.filterDate(ref_date, stop_date.advance(-1, 'month')).qualityMosaic('ndvi'); 
      
      var maxDoy_millis = maxNDVI.select('timestamp'); // needed for masking purpose
      var maxDoy_format = maxNDVI.select('formatted'); // it could be an output
      var maxDoy_doy    = maxNDVI.select('doy');       // it could be an output

      // C) NDVI min pre-picco (SGS) -> this will be renamed to (CWS, crop window start)

      var NDVI_prePicco = NDVI_with_doy.map(function(img){
        var time = img.select('timestamp');
        
        var mask_start = SGS_temp.lte(time);
        var mask_stop  = maxDoy_millis.gte(time);
        var mask       = mask_start.multiply(mask_stop);
        
        var ndvi_masked = img.select('ndvi').multiply(ee.Image.constant(-1));
        return img.addBands(ndvi_masked.updateMask(mask).rename('ndvi_masked'));
      });
      
      var minNDVI_prePicco = NDVI_prePicco.qualityMosaic('ndvi_masked'); // ndvi masked is negative!
      
      var SGS_millis    = minNDVI_prePicco.select('timestamp'); // needed for masking purpose
      var SGS_format    = minNDVI_prePicco.select('formatted'); // it could be an output
      var SGS_doy       = minNDVI_prePicco.select('doy');       // it could be an output

      // D) NDVI min post-picco (EGS)-> this will be renamed to (CWE, crop window end)
      
      var NDVI_postPicco = NDVI_with_doy.map(function(img){
        var time = img.select('timestamp');
        
        var mask = maxDoy_millis.lte(time);
      
        var ndvi_masked = img.select('ndvi').multiply(ee.Image.constant(-1));
        return img.addBands(ndvi_masked.updateMask(mask).rename('ndvi_masked'));
      });
      
      var minNDVI_postPicco = NDVI_postPicco.qualityMosaic('ndvi_masked'); // ndvi masked is negative!
      
      var EGS_millis    = minNDVI_postPicco.select('timestamp'); // needed for masking purpose
      var EGS_format    = minNDVI_postPicco.select('formatted'); // it could be an output
      var EGS_doy       = minNDVI_postPicco.select('doy');       // it could be an output

      // D) NDVI normalizzato (della CROP) : FVC
          
      var NDVI = NDVI_int.map(function(img){
      
      var date = ee.Date(img.get('system:time_start'));
      var dateImage = ee.Image.constant(date.millis()).rename(['timestamp']).toFloat();
      
      var mask_start = SGS_millis.lte(dateImage);
      var mask_stop  = EGS_millis.gte(dateImage);
      var mask = mask_start.multiply(mask_stop);
      
      var ndvi_masked = img.multiply(mask);
      return ndvi_masked.copyProperties(img, ['system:time_start']);
    });
    
      var FVC = veg_functions.get_FVC(NDVI, maxNDVI, minNDVI_prePicco);    

      // F) SOS and EGS -> those will be the new SOS and EOS
      
      var NDVI_prePicco = FVC.map(function(img){
        var date = ee.Date(img.get('system:time_start'));
        var dateImage = ee.Image.constant(date.millis()).rename(['timestamp']).toFloat();
        
        var mask_date  = maxDoy_millis.gte(dateImage);
        var ndvi_masked = img.select('FVC').lte(0.21);
        var mask = mask_date.multiply(ndvi_masked);
        
        return img.select('FVC').updateMask(mask).rename('fvc_masked');
      });
      
      var SOS_TRFII = NDVI_prePicco.map(addDateBands).qualityMosaic('fvc_masked'); 
      
      var SOS_TRFII_millis    = SOS_TRFII.select('timestamp'); // needed for masking purpose
      var SOS_TRFII_format    = SOS_TRFII.select('formatted'); // it could be an output
      var SOS_TRFII_doy       = SOS_TRFII.select('doy');       // it could be an output
      
      
      var NDVI_postPicco = FVC.map(function(img){
        var date = ee.Date(img.get('system:time_start'));
        var dateImage = ee.Image.constant(date.millis()).rename(['timestamp']).toFloat();
        
        var mask_date  = maxDoy_millis.lte(dateImage);
        var ndvi_masked = img.select('FVC').lte(0.21);
        var mask = mask_date.multiply(ndvi_masked);
        
        return img.select('FVC').updateMask(mask).rename('fvc_masked');
      });
      
      var EGS_TRFII = NDVI_postPicco.map(addDateBands).qualityMosaic('fvc_masked');
      
      var EGS_TRFII_millis    = EGS_TRFII.select('timestamp'); // needed for masking purpose
      var EGS_TRFII_format    = EGS_TRFII.select('formatted'); // it could be an output
      var EGS_TRFII_doy       = EGS_TRFII.select('doy');       // it could be an output
      

      // *********************************************************
      // 5. compute water STRESS and LAI
      
      // A) water stress
      var RSWCnmi = stress_functions.compute_waterSTRESS(FVC, awi);
      
      // collection LAI (della CROP)
      var lai_flo = maxNDVI.expression({
        expression: NDVI_to_LAIexp,
        map: {ndvi: maxNDVI.select('ndvi')}
        });
        
      var LAI = FVC.map(function(img){
        var lai = img.multiply(lai_flo);
        
        var mask0 = lai.gte(0);
        
        return lai.multiply(mask0).rename("lai").copyProperties(img, ["system:time_start"]);
      });   
      
      // *********************************************************
      // 5. Photosyntetic Rate
      
      var start_date_LAI = LAI.sort('system:time_start')       .first().date(); // new start date is needed to make sure that all the stresses have valid bands/images
      var stop_date_LAI  = LAI.sort('system:time_start', false).first().date();

      switch (env) {
        
        case 'opt':
          print('computing opt conditions');
          var ic_ph =  weather_col
                          .filterDate(start_date_LAI, stop_date_LAI) // remind: "stop_date" is not inclusive
                          .select('GSR')
                          .map(function(img){
                            var timestamp = img.date().millis();
      
                            // Get stress variables
                            var fTemp   = fTemp_col.filter(ee.Filter.eq('system:time_start', timestamp)).first();
      
                            // Get LAI
                            var lai     = LAI.filter(ee.Filter.eq('system:time_start', timestamp));
                            lai = ee.Image(ee.Algorithms.If({condition: lai.size(), trueCase:  lai.first(), falseCase: ee.Image.constant(0)})).set('system:time_start', timestamp); // just checks if there are missing dates with users' own vegetation collections. If true, then lai is 0 for that day.
                            
                            // Get PAR
                            var PAR = img.select('GSR').divide(ee.Image.constant(2)); // multiply by the photosynthetically active radiation (0.5)
                            
                            // Compute NPP
                            var npp_exp = 'npp = PAR * (1 - e ** (- k * L))';
                            var npp     = PAR.expression({
                                            expression: npp_exp,
                                            map: {
                                                  PAR: PAR.select('GSR'),
                                                  e : ee.Image.constant(ee.Number(Math.E)),
                                                  k : ee.Image.constant(k),
                                                  L : lai
                                                 }
                                            });
      
                            var ph = npp.multiply(ee.Image.constant(RUE)).multiply(fTemp).rename('ph');
      
                            return ph.copyProperties(img, ["system:time_start"]);
      });
          break;
        
        case 'hot':
          print('computing hot conditions');
          var ic_ph =  weather_col
                          .filterDate(start_date_LAI, stop_date_LAI) // remind: "stop_date" is not inclusive
                          .select('GSR')
                          .map(function(img){
                            var timestamp = img.date().millis();
      
                            // Get stress variables
                            var fTemp   = fTemp_col.filter(ee.Filter.eq('system:time_start', timestamp)).first();
                            var fHeat   = fHeat_col.filter(ee.Filter.eq('system:time_start', timestamp)).first();
      
                            // Get LAI
                            var lai     = LAI.filter(ee.Filter.eq('system:time_start', timestamp));
                            lai = ee.Image(ee.Algorithms.If({condition: lai.size(), trueCase:  lai.first(), falseCase: ee.Image.constant(0)})).set('system:time_start', timestamp); // just checks if there are missing dates with users' own vegetation collections. If true, then lai is 0 for that day.
                            
                            // Get PAR
                            var PAR = img.select('GSR').divide(ee.Image.constant(2)); // multiply by the photosynthetically active radiation (0.5)
                            
                            // Compute NPP
                            var npp_exp = 'npp = PAR * (1 - e ** (- k * L))';
                            var npp     = PAR.expression({
                                            expression: npp_exp,
                                            map: {
                                                  PAR: PAR.select('GSR'),
                                                  e : ee.Image.constant(ee.Number(Math.E)),
                                                  k : ee.Image.constant(k),
                                                  L : lai
                                                 }
                                            });
      
                            var ph = npp.multiply(ee.Image.constant(RUE)).multiply(fTemp).multiply(fHeat).rename('ph');
      
                            return ph.copyProperties(img, ["system:time_start"]);
      });
          break;
        
        case 'cold':
          print('computing cold conditions');
          var ic_ph =  weather_col
                          .filterDate(start_date_LAI, stop_date_LAI) // remind: "stop_date" is not inclusive
                          .select('GSR')
                          .map(function(img){
                            var timestamp = img.date().millis();
      
                            // Get stress variables
                            var fTemp   = fTemp_col.filter(ee.Filter.eq('system:time_start', timestamp)).first();
                            var fCold   = fCold_col.filter(ee.Filter.eq('system:time_start', timestamp)).first();
      
                            // Get LAI
                            var lai     = LAI.filter(ee.Filter.eq('system:time_start', timestamp));
                            lai = ee.Image(ee.Algorithms.If({condition: lai.size(), trueCase:  lai.first(), falseCase: ee.Image.constant(0)})).set('system:time_start', timestamp); // just checks if there are missing dates with users' own vegetation collections. If true, then lai is 0 for that day.
                            
                            // Get PAR
                            var PAR = img.select('GSR').divide(ee.Image.constant(2)); // multiply by the photosynthetically active radiation (0.5)
                            
                            // Compute NPP
                            var npp_exp = 'npp = PAR * (1 - e ** (- k * L))';
                            var npp     = PAR.expression({
                                            expression: npp_exp,
                                            map: {
                                                  PAR: PAR.select('GSR'),
                                                  e : ee.Image.constant(ee.Number(Math.E)),
                                                  k : ee.Image.constant(k),
                                                  L : lai
                                                 }
                                            });
      
                            var ph = npp.multiply(ee.Image.constant(RUE)).multiply(fTemp).multiply(fCold).rename('ph');
      
                            return ph.copyProperties(img, ["system:time_start"]);
      });  
        break;
      
        case 'dry':
          print('computing dry conditions');
          var ic_ph =  weather_col
                          .filterDate(start_date_LAI, stop_date_LAI) // remind: "stop_date" is not inclusive
                          .select('GSR')
                          .map(function(img){
                            var timestamp = img.date().millis();
      
                            // Get stress variables
                            var fTemp   = fTemp_col.filter(ee.Filter.eq('system:time_start', timestamp)).first();
                            var RSWC    = RSWCnmi  .filter(ee.Filter.eq('system:time_start', timestamp)).first(); 
      
                            // Get LAI
                            var lai     = LAI.filter(ee.Filter.eq('system:time_start', timestamp));
                            lai = ee.Image(ee.Algorithms.If({condition: lai.size(), trueCase:  lai.first(), falseCase: ee.Image.constant(0)})).set('system:time_start', timestamp); // just checks if there are missing dates with users' own vegetation collections. If true, then lai is 0 for that day.
                            
                            // Get PAR
                            var PAR = img.select('GSR').divide(ee.Image.constant(2)); // multiply by the photosynthetically active radiation (0.5)
                            
                            // Compute NPP
                            var npp_exp = 'npp = PAR * (1 - e ** (- k * L))';
                            var npp     = PAR.expression({
                                            expression: npp_exp,
                                            map: {
                                                  PAR: PAR.select('GSR'),
                                                  e : ee.Image.constant(ee.Number(Math.E)),
                                                  k : ee.Image.constant(k),
                                                  L : lai
                                                 }
                                            });
      
                            var ph = npp.multiply(ee.Image.constant(RUE)).multiply(fTemp).multiply(RSWC).rename('ph');
      
                            return ph.copyProperties(img, ["system:time_start"]);
      });  
        break;
      }
    
      // *********************************************************
      // 6. Yield

      var vegetative_biomass = ic_ph.map(function (img){
              var timestamp = img.date().millis();
              var dateImage = ee.Image.constant(timestamp).toFloat();
              
              // Compute Vegetative Biomass
              var mask = maxDoy_millis.gte(dateImage);
                            
              var veg_bio =  img.select('ph').multiply(mask).rename('veg_bio');
              
              return  veg_bio.copyProperties(img, ["system:time_start"]);
              
      }).sum().multiply(coeff_rim);
      
      var yield_crop = ic_ph.map(function (img){
              var timestamp = img.date().millis();
              var dateImage = ee.Image.constant(timestamp).toFloat();
              
              
              var mask = maxDoy_millis.lte(dateImage);
              
              var yield_cr   = img.select('ph').add(vegetative_biomass.select('veg_bio')).multiply(mask).rename('yield');
      
              return yield_cr.copyProperties(img, ["system:time_start"]);
              
      }).sum(); 
      
      
      // *********************************************************
      // 7. export    
      var phenoPalette = ['ff0000','ff8d00','fbff00','4aff00','00ffe7','01b8ff','0036ff','fb00ff'];
      var visSGS = {min:120,max:200,palette:phenoPalette};
      var visEGS = {min:200,max:300,palette:phenoPalette};
      
      // var yield_maxVal = yield_crop.divide(100).reduceRegion({
      //                                         reducer: ee.Reducer.max(),
      //                                         geometry: CrYP_ui.AOI,
      //                                         scale: 1000,  
      //                                         maxPixels: 1e13
      //                                       });
                                            
      // yield_maxVal = yield_maxVal.get('yield').getInfo();


      Map.addLayer(SOS_TRFII_doy, visSGS, 'SOS');
      Map.addLayer(EGS_TRFII_doy, visEGS, 'EGS');
      // Map.addLayer(yield_crop.divide(100), {palette:['white', 'green']}, 'yield'); // .divide(100) -> g/m-2 to Mg/m-2

      Export.image.toDrive({image: EGS_TRFII_doy.toInt(), scale: 250, region:AOI, description: 'EGS_doy'});
      Export.image.toDrive({image: SOS_TRFII_doy.toInt(), scale: 250, region:AOI, description: 'SOS_doy'});
      Export.image.toDrive({image: maxDoy_doy.toInt(),    scale: 250, region:AOI, description: 'maxDoy_doy'});
      
      Export.image.toDrive({image: yield_crop.toInt(),    scale: 250, region:AOI, description: 'yield_crop'});

};

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
var CrYP_ui = {
  crop : {
    species : null, // maize or wheat
    year    : null, // start year
    month   : null, // start month
    extent  : null  
  },
  
  scenario : null, // opt, heat, cold, dry
  
  vegCollection : null,
  
  AOI : null,      // it will be a geometry
  
  model: {
    Tbase     : null, // Tmin
    Topt      : null,
    Tmax      : null,
    Text_cold : null,
    Text_heat : null,
    
    RUE       : null,
    k         : null, 
    mov_win   : null,
    coeff_rim : null
  }
};

CrYP_ui.OnSEChange=function(isChecked){
    //print(this);
    if (isChecked===true) {
      //print('yes')
      CrYP_ui.spatialExtGeoSel.setDisabled(true);
      CrYP_ui.spatialExtAssetsSel.setDisabled(false);
    } else {
      CrYP_ui.spatialExtGeoSel.setDisabled(false);
      CrYP_ui.spatialExtAssetsSel.setDisabled(true);
    }}

CrYP_ui.OnSEChange2 = function(isChecked){
      if (isChecked===true) {
        CrYP_ui.textFolder.setDisabled(false);
        CrYP_ui.vegetationSelector.setDisabled(false);
      } else {
        CrYP_ui.textFolder.setDisabled(true);
        CrYP_ui.vegetationSelector.setDisabled(true);
      }};
    
CrYP_ui.Start = function (){    
  var labelStyle= {width:'120px',fontSize:'14px', fontWeight:'bold'};
  var labelStyle2= {width:'300px',fontSize:'14px', fontWeight:'bold'};
  var panelStyle= {border:'1px solid blue',width: '650px',margin:'3px'};
  var controlPanel   = ui.Panel({style: {width: '680px',height:'1000px'}});
  
  controlPanel.add(ui.Label('CrYP: Crop Yield Prediction',
                  {fontWeight:'bold', margin:'3px', fontSize:'18px'}));
  
  controlPanel.add(ui.Label('An open source app for computing, visualizing and exporting crop phenology and yield maps.',
                  {fontWeight:'regular',margin:'3px',
                  fontSize:'14px'}));
  
  controlPanel.add(ui.Label('The scientific paper presenting CrYP is under review.',
                  {fontWeight:'regular',margin:'6px',
                  fontSize:'10px'}));
  
  // Section A: Crop type and Scenario
  
  var crop_list = ['Maize', 'Winter crops'];
  CrYP_ui.cropTypeSelector = ui.Select({
        items: crop_list,
        placeholder: 'Select a crop',
        onChange: function (value) {CrYP_ui.crop.species = value},
        style : {stretch: 'horizontal'}});
        
  var scenario_list = ['potential', 'heat-limited', 'cold-limited', 'water-limited'];
  CrYP_ui.ScenarioSelector = ui.Select({
        items: scenario_list,
        placeholder: 'Select a scenario',
        onChange: function (value) {
          switch (value){
            case 'potential':
              CrYP_ui.scenario = 'opt'
              break;
            case 'cold-limited':
              CrYP_ui.scenario = 'cold'
              break;
            case 'heat-limited':
              CrYP_ui.scenario = 'hot'
              break;
            case 'water-limited':
              CrYP_ui.scenario = 'dry'
              break;}},
        style : {stretch: 'horizontal'}});

  var croptypePanel = ui.Panel({style: {width: '320px'}})    
                       .add(ui.Panel([ui.Label("Crop Type:", labelStyle), CrYP_ui.cropTypeSelector], ui.Panel.Layout.flow('horizontal')));
                            
  var scenarioPanel = ui.Panel({style: {width: '320px'}})    
                        .add(ui.Panel([ui.Label("Production level:", labelStyle), CrYP_ui.ScenarioSelector], ui.Panel.Layout.flow('horizontal')));
                            
  controlPanel.add(ui.Panel([croptypePanel, scenarioPanel], ui.Panel.Layout.flow('horizontal'), panelStyle));

  // Section B: Crop Calendar (temporal extent)
  
  var dates = ee.List(ee.ImageCollection("MODIS/006/MOD13Q1").get('date_range')).getInfo();
  var start = ee.Date(dates[0]).get('year');
  var end   = ee.Date(dates[1]).get('year');
  
  var yList     = ee.List.sequence(start, end).map(function(y){
                            return ee.String(y).slice(0,4);
                          }).getInfo();

  CrYP_ui.cropYearSelector = ui.Select({
        items: yList,
        placeholder: 'select year',
        onChange: function (value) {
          CrYP_ui.crop.year = Number(value);}
          });
        
  var month_list = ee.List([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]).map(function(y){
                            return ee.String(y).slice(0,4);
                          }).getInfo();
                          
  CrYP_ui.cropMonthSelector = ui.Select({
        items: month_list,
        placeholder: 'select month',
        onChange: function (value) {
          CrYP_ui.crop.month = Number(value);}
    
  });
        
 CrYP_ui.cropExtentSelector = ui.Slider({value:0,min:0,max:12,step:1, 
        onChange: function(value){CrYP_ui.crop.extent = Number(value);},
        style:{stretch: 'horizontal'}
        });
        
  var yearPanel = ui.Panel({style: {width: '230px'}})    
                       .add(ui.Panel([ui.Label("Crop Calendar:", labelStyle), CrYP_ui.cropYearSelector], ui.Panel.Layout.flow('horizontal')));
                            
  var monthPanel = ui.Panel({style: {width: '110px'}})    
                        .add(ui.Panel([CrYP_ui.cropMonthSelector], ui.Panel.Layout.flow('horizontal')));
  
  var extentPanel = ui.Panel({style: {width: '300px'}})    
                        .add(ui.Panel([ui.Label("growing season length (months):", {width: '120px', fontSize:'12px'}), CrYP_ui.cropExtentSelector], ui.Panel.Layout.flow('horizontal')));
                        
  controlPanel.add(ui.Panel([yearPanel, monthPanel, extentPanel], ui.Panel.Layout.flow('horizontal'), panelStyle));
 

  // Section C: AOI
  
  var activeNameList = Map.drawingTools().layers().map(function(lyr){
                        return lyr.getName();
                         });
 
  CrYP_ui.spatialExtGeoSel = ui.Select({items:activeNameList,
                       placeholder:"Active geometry",
                       onChange:function(value){  
                         var ind=activeNameList.indexOf(value);
                         CrYP_ui.AOI=ee.FeatureCollection(Map.drawingTools().layers().get(ind).toGeometry());
                         Map.centerObject(CrYP_ui.AOI);
                       },
                       style:{width:'120px'}});
    
    //extract avaliable feature (table) from assets
      var rootAssetsFolder = ee.data.listBuckets("projects/earthengine-legacy").assets;//ee.data.getAssetRoots();

      var ft_ids=[]; 
      var disable=true;
      if (Object.keys(rootAssetsFolder).length !== 0)  {
        var assetslist= ee.data.listAssets(rootAssetsFolder[0].id);
        if (assetslist.assets !== null){// ensure none empty assets
        disable=false; 
        //var assetslist= ee.data.listAssets(rootAssetsFolder[0].id);
        ft_ids=assetslist.assets
                  .filter(function(obj){return obj.type=='TABLE';})
                  .map(function(obj){return obj.id;});
      } }
      
      
    CrYP_ui.spatialExtAssetsSel = ui.Select({items:ft_ids,
                       placeholder:"Assets",
                       onChange:function(value){
                         CrYP_ui.AOI=ee.FeatureCollection(value);
                         Map.addLayer(CrYP_ui.AOI);
                         Map.centerObject(CrYP_ui.AOI);
                       },
                       disabled:true,
                       style:{width:'120px'}});
    
    
    controlPanel.add(ui.Panel([ui.Label("Study area:",labelStyle),
                              ui.Checkbox("From Assets",false,CrYP_ui.OnSEChange,disable),
                              CrYP_ui.spatialExtGeoSel,CrYP_ui.spatialExtAssetsSel],
                              ui.Panel.Layout.flow('horizontal'),panelStyle)); 
    
    // Section D: Vegetation (select your own collection, if wanted)

    CrYP_ui.textFolder =  ui.Textbox({
        placeholder: 'e.g. projects/ee-lcrecco94/assets/',
        onChange: function (value) {
                  // Clear the current selector items
                  CrYP_ui.vegetationSelector.items().reset([]);
                
                  // Get List of Assets
                  var publicAssets = ee.data.listAssets(value);
                  var assets = publicAssets['assets'];
                  
                  var assetNames = [];
                  for (var i=0; i< assets.length; i++) {
                    if (assets[i].type == 'IMAGE_COLLECTION')
                      assetNames.push(assets[i].id)
                  }
                  
                  // Set new list of Assets
                  CrYP_ui.vegetationSelector.items().reset(assetNames);
                  },
        disabled: true,
       style:{width:'300px'}
    }
      );
      
      
    CrYP_ui.vegetationSelector =  ui.Select({
        placeholder:"Assets",
        onChange:function(value){
        CrYP_ui.vegCollection = ee.ImageCollection(value);
        },
        disabled:true,
      style:{width:'120px'}
    });
    
    var disable2 = false;

    controlPanel.add(ui.Panel([ui.Label("Load NDVI data?", labelStyle),
                              ui.Checkbox("Yes",false,CrYP_ui.OnSEChange2,disable2),
                              CrYP_ui.textFolder,CrYP_ui.vegetationSelector],
                              ui.Panel.Layout.flow('horizontal'),panelStyle)); 
       
    
    // Section E: Crop and Model Parameters
    
    var cropCardinalTempPanel =ui.Panel({style: {width: '320px'}})
        .add(ui.Label('Crop model parameters:', labelStyle2))
        .add(ui.Panel([ui.Label('Topt (°C):     ', {width:'100px'}), ui.Slider({value:28,min:-5,max:50,step:1,
                onChange:function(value){CrYP_ui.model.Topt=ee.Image.constant(Number(value));},
                style:{stretch: 'horizontal'}})],ui.Panel.Layout.flow('horizontal')))   
        .add(ui.Panel([ui.Label('Tbase (°C):    ', {width:'100px'}), ui.Slider({value:8,min:-5,max:50,step:1,
                onChange:function(value){CrYP_ui.model.Tbase=ee.Image.constant(Number(value));},
                style:{stretch: 'horizontal'}})],ui.Panel.Layout.flow('horizontal'))) 
        .add(ui.Panel([ui.Label('Tmax (°C):     ', {width:'100px'}), ui.Slider({value:34,min:-5,max:50,step:1,
                onChange:function(value){CrYP_ui.model.Tmax=ee.Image.constant(Number(value));},
                style:{stretch: 'horizontal'}})],ui.Panel.Layout.flow('horizontal'))) 
        .add(ui.Panel([ui.Label('Text_heat (°C):', {width:'100px'}), ui.Slider({value:37,min:-5,max:50,step:1,
                onChange:function(value){CrYP_ui.model.Text_heat=ee.Image.constant(Number(value));},
                style:{stretch: 'horizontal'}})],ui.Panel.Layout.flow('horizontal'))) 
        .add(ui.Panel([ui.Label('Text_cold (°C):', {width:'100px'}), ui.Slider({value:0,min:-5,max:50,step:1,
                onChange:function(value){CrYP_ui.model.Text_cold=ee.Image.constant(Number(value));},
                style:{stretch: 'horizontal'}})],ui.Panel.Layout.flow('horizontal'))) 
                
    var modelPanel =ui.Panel({style: {width: '320px'}})
        .add(ui.Label('', labelStyle2))
        .add(ui.Panel([ui.Label('RUE:', {width:'100px'}), ui.Slider({value:0,min:0,max:5,step:1,
                onChange:function(value){CrYP_ui.model.RUE=Number(value);},
                style:{stretch: 'horizontal'}})],ui.Panel.Layout.flow('horizontal')))   
        .add(ui.Panel([ui.Label('k:', {width:'100px'}), ui.Slider({value:0,min:0,max:1,step:0.1,
                onChange:function(value){CrYP_ui.model.k=Number(value);},
                style:{stretch: 'horizontal'}})],ui.Panel.Layout.flow('horizontal'))) 
        .add(ui.Panel([ui.Label('moving_wind:', {width:'100px'}), ui.Slider({value:7,min:7,max:15,step:1,
                onChange:function(value){CrYP_ui.model.mov_win=Number(value);},
                style:{stretch: 'horizontal'}})],ui.Panel.Layout.flow('horizontal')))
        .add(ui.Panel([ui.Label('remob_coeff:', {width:'100px'}), ui.Slider({value:0.01,min:0.01,max:0.1,step:0.01,
                onChange:function(value){CrYP_ui.model.coeff_rim=Number(value);},
                style:{stretch: 'horizontal'}})],ui.Panel.Layout.flow('horizontal'))) 

                

                
                
  controlPanel.add(ui.Panel([cropCardinalTempPanel, modelPanel], ui.Panel.Layout.flow('horizontal'), panelStyle));
 
    
    
    var runButton = ui.Button('Run');
    runButton.onClick(run);     

    controlPanel.add(runButton);

ui.root.add(controlPanel);
};

CrYP_ui.Start();
