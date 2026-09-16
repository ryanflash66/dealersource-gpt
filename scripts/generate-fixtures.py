"""Author original synthetic fixtures. Not used during normal setup or execution."""
from pathlib import Path
import json
ROOT=Path(__file__).resolve().parents[1]
base={"suite":"office","base_monthly":800,"quote_written":True,"quote_age_days":0,
 "office":{"enclosed":True,"sqft":120,"separate_entrance":True},"display_count":4,
 "signage_available":True,"records_storage":True,"public_contact_hours":True,
 "shared":False,"sublease_consent":True,"available":True,"minutes":25,"inside_isochrone":True,
 "traffic":20000,"frontage_m":60,"corner":True,"line_of_sight":0.8,"competitors":2,
 "centroid_zone":"X","high_risk_fraction":0.0,"flood_coverage_complete":True,
 "zoning_status":"permitted","zoning_method":"official_layer_and_use_table","conditions_met":True,
 "zoning_section":"Synthetic UDO 12.3: used vehicle sales","zoning_age_days":0}
def row(i,title,**changes):
 out={**base,"external_id":f"listing-{i}","title":title,"address":f"{100+i} Fixture Avenue, Greenville, NC 27858",
 "parcel_id":f"SYNTHETIC-P-{i}","lat":35.60+i*.002,"lon":-77.37+i*.003,
 "leasing_email":f"leasing-{i}@example.invalid","planning_email":"planning@example.invalid",**changes}
 return out
rows=[row(1,'Standalone office and display',traffic=18000,minutes=18),
 row(2,'Corner site with flood warning',base_monthly=950,traffic=32000,centroid_zone='X_SHADED',minutes=32),
 row(3,'Shared site, high raw score',base_monthly=650,traffic=65000,minutes=10,frontage_m=150,competitors=0,shared=True),
 row(4,'Below hard rent floor',base_monthly=500),row(5,'High-risk centroid',centroid_zone='AE',high_risk_fraction=.1),
 row(6,'Missing rent, answered by fixture reply',base_monthly=None,quote_written=False),
 row(7,'Zoning unanswered',zoning_status='unknown'),
 row(8,'No enclosed office',office={"enclosed":False,"sqft":0,"separate_entrance":False}),
 row(9,'Beyond drive-time search',minutes=75,inside_isochrone=False),
 row(10,'Majority high-risk area',centroid_zone='X',high_risk_fraction=.65),
 row(11,'Conditional use awaiting approval',zoning_status='conditional',conditions_met=False),
 row(12,'Expired written rent quote',quote_age_days=10),
 row(13,'Second suite at the same property',address='101 Fixture Avenue, Greenville, NC 27858',parcel_id='SYNTHETIC-P-1',suite='suite B',base_monthly=875,traffic=12000)]
rows.append({**rows[0],"external_id":"listing-1-syndicated","syndicated_from":"listing-1"})
(ROOT/'fixtures'/'sites.json').write_text(json.dumps(rows,indent=2)+'\n')
raw={"provenance":"original synthetic fixture, not live property data","listings":rows}
(ROOT/'fixtures'/'raw-listings.json').write_text(json.dumps(raw,indent=2)+'\n')
(ROOT/'fixtures'/'replies.json').write_text(json.dumps([{"external_id":"fixture-reply-rent-6","site_listing_id":"listing-6","fact":"rent","from":"leasing-6@example.invalid","body":"The exact office and display allocation is available for base rent USD 850 per month. This is a synthetic written quote.","value":{"monthly":850,"written":True,"currency":"USD"},"stop":False}],indent=2)+'\n')
print('Wrote synthetic listing, provider-input, and inbound-reply fixtures.')
