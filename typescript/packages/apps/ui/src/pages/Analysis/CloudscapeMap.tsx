import { borderRadiusContainer, colorBorderDividerDefault } from '@cloudscape-design/design-tokens';
import { Feature } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Fragment, useMemo, useRef, useState } from 'react';
import { GeolocateControl, Layer, Map, MapRef, NavigationControl, ScaleControl, Source } from 'react-map-gl/maplibre';
import { useSearchParams } from 'react-router-dom';
import { useMapAuth } from '../../hooks/useMapAuth';
import { useMapBoundingBox } from '../../hooks/useMapBoundingBox';
import { useGetFeaturesQuery } from '../../slices/tilerApiSlice';
import './Analysis.css';
import ControlPanel, { getMapName } from './ControlPanel';
import FeaturePopup from './FeaturePopup';

const UI_TILER_API_ENDPOINT = import.meta.env.VITE_UI_REST_API_URL;
const MAP_REGION = import.meta.env.VITE_LOCATION_SERVICE_MAP_REGION;

export interface ArcadeFeature extends Feature {
	collection: string;
}

interface TileFilterOptions {
	region_id?: string;
	// polygon_id?: string;
	timestamp?: string;
	image_type?: string;
}

const CloudscapeMap = () => {
	const [selectedMapId, setSelectedMapId] = useState('base-map');
	const [selectedBandsId, setSelectedBandsId] = useState('rgb');
	const [showBoundaries, setShowBoundaries] = useState<boolean>(false);
	const [popupInfo, setPopupInfo] = useState<any>(null);
	const mapRef = useRef<MapRef | null>(null);
	const { boundingBox, updateBoundingBox } = useMapBoundingBox(mapRef);
	const transformRequest = useMapAuth();
	const [searchParams] = useSearchParams();
	const bboxToViewState = (bbox: string) => {
		const [minLng, minLat, maxLng, maxLat] = JSON.parse(bbox);
		const centerLng = (minLng + maxLng) / 2;
		const centerLat = (minLat + maxLat) / 2;
		const latDiff = Math.abs(maxLat - minLat);
		const lngDiff = Math.abs(maxLng - minLng);
		const maxDiff = Math.max(latDiff, lngDiff);
		const zoom = Math.round(20 - Math.log2((maxDiff * 360) / (2 * Math.PI * 6378137)));
		const viewportData = {
			longitude: centerLng,
			latitude: centerLat,
			zoom: zoom,
		};
		return viewportData;
	};
	const { data: features = [] } = useGetFeaturesQuery(
		{
			bbox: boundingBox!,
			region_id: searchParams.get('farmId') ?? undefined,
			timestamp: searchParams.get('timestamp') ?? undefined,
		},
		{ skip: boundingBox === undefined }
	);

	const queryString = useMemo(() => {
		// Create a new object with only the properties that have non-undefined values
		const queryParams: TileFilterOptions = {
			region_id: searchParams.get('farmId') ?? undefined,
			timestamp: searchParams.get('timestamp') ?? undefined,
			image_type: selectedBandsId,
		};
		const filteredQueryParams = Object.entries(queryParams)
			.filter(([_, value]) => value !== undefined)
			.reduce((obj, [key, value]) => ({ ...obj, [key]: value }), {});

		if (selectedBandsId) {
			queryParams['image_type'] = selectedBandsId;
		}
		return new URLSearchParams(filteredQueryParams).toString();
	}, [selectedBandsId, searchParams]);

	return (
		<div style={{ position: 'relative', height: '80vh' }}>
			{transformRequest !== undefined && (
				<Map
					// Update the bounding box whenever viewport changes
					onMoveEnd={updateBoundingBox}
					// Store a ref to the map so we can look up the bounding box later
					ref={(map) => {
						mapRef.current = map;
					}}
					// Near the Denver location
					initialViewState={
						searchParams.has('bbox')
							? bboxToViewState(searchParams.get('bbox')!)
							: {
									longitude: -104.4894065,
									latitude: 39.9193435,
									zoom: 13,
							  }
					}
					style={{ height: '100%', borderRadius: borderRadiusContainer, borderColor: colorBorderDividerDefault, borderWidth: '2px', borderStyle: 'solid' }}
					// Amazon Location Service map
					mapStyle={`https://maps.geo.${MAP_REGION}.amazonaws.com/maps/v0/maps/${getMapName(selectedMapId)}/style-descriptor`}
					// Fill layers need to be interactive so they can trigger a popup when clicked
					interactiveLayerIds={features.map((feature: Feature) => `fill-${feature.id}`)}
					// Add auth headers to requests the map component makes
					transformRequest={transformRequest}
					// Trigger a popup about the feature when a fill layer is clicked
					onClick={(e: any) => {
						const clickedFeatures = e.features;
						if (clickedFeatures && clickedFeatures.length > 0) {
							const feature = clickedFeatures[0];
							console.log('Clicked Feature:', feature);
							setPopupInfo({
								lngLat: e.lngLat,
								...feature,
							});
						} else {
							setPopupInfo(null);
						}
					}}
				>
					<ScaleControl />
					<GeolocateControl />
					<NavigationControl />
					<Source key={`tiles-mosaic`} type="raster" tiles={[`${UI_TILER_API_ENDPOINT}tiles/{z}/{x}/{y}?${queryString}`]} minzoom={8} maxzoom={16}>
						<Layer key={`tiles-layer-mosaic`} id={`tiles-layer-mosaic`} type="raster" />
					</Source>
					{features.map((feature: ArcadeFeature) => {
						// Two layers are made here:
						// 1. A fill layer that fills the feature boundaries with clear fill so it can be clicked
						// 2. A line layer that outlines the feature boundaries for visibility
						return (
							<Fragment key={feature.id}>
								<Source key={feature.id} id={`boundary-${feature.id}}`} type="geojson" data={feature}>
									<Layer
										id={`fill-${feature.id}`}
										type="fill"
										layout={{ visibility: showBoundaries ? 'visible' : 'none' }}
										paint={{
											'fill-color': 'rgba(0, 0, 0, 0)', // Clear fill color
										}}
									/>
									<Layer
										id={`outline-${feature.id}`}
										type="line"
										layout={{ visibility: showBoundaries ? 'visible' : 'none' }}
										paint={{
											'line-color': 'rgba(255, 0, 0, 1)', // Red line color
											'line-width': 3, // Line weight of 3
										}}
									/>
								</Source>
							</Fragment>
						);
					})}
					{popupInfo && (
						// Popup that displays the feature details when a feature is clicked
						<FeaturePopup popupInfo={popupInfo} onClose={() => setPopupInfo(null)} />
					)}
				</Map>
			)}
			<div className="control-panel-container">
				<ControlPanel
					selectedMapId={selectedMapId}
					setSelectedMapId={setSelectedMapId}
					selectedBandsId={selectedBandsId}
					setSelectedBandsId={setSelectedBandsId}
					showBoundaries={showBoundaries}
					setShowBoundaries={setShowBoundaries}
				/>
			</div>
		</div>
	);
};

export default CloudscapeMap;
