-- 173_te_hubs_every_city.sql — an airport and a station for every city on the
-- city master.
-- SAFE TO RUN TWICE. Inserts only what is missing; changes no existing row.
-- ----------------------------------------------------------------------------
-- WHY. A flight or a train starts somewhere other than where you are, so the
-- engine resolves a hub for each end (hubFor in te-engine.js: the place itself
-- if it IS a hub, otherwise te_hubs for the city or its region). With no hub
-- the plan is refused — "Choose the airport you arrive at in Jaipur" — and the
-- employee is sent to pick one by hand, every time, on every trip.
--
-- Seven hubs were configured and twenty-four cities are on the master, so most
-- routes could not be planned by air or rail at all. Jaipur had a station and
-- no airport; Mumbai had an airport and no station. Neither Mumbai–Jaipur by
-- flight nor by train could be saved.
--
-- WHAT THIS ADDS, per company that has Travel and Expense set up:
--   13 airports  Ahmedabad, Chandigarh, Chennai, Dehradun, Guwahati,
--                Hyderabad, Indore, Jaipur, Kochi, Kolkata, Lucknow, Nagpur,
--                Raipur
--   15 stations  Ahmedabad, Bengaluru, Chandigarh, Chennai, Dehradun,
--                Guwahati, Hyderabad, Indore, Kochi, Kolkata, Lucknow,
--                Mumbai, Nagpur, Pune, Raipur
-- Delhi and the rest of the NCR already resolve through the NCR region, and
-- Bengaluru, Mumbai, Pune and Dubai already had their airports.
--
-- WHERE THE COORDINATES COME FROM. Google Places, looked up one terminal at a
-- time, not typed from memory. They are not decoration: the ride to the
-- airport is a claimable leg and its distance is measured from this point.
-- Each is the passenger terminal, to six decimal places.
--
-- IDEMPOTENT TWICE OVER. A place is matched on (company, code, type) and only
-- inserted when absent; the city-to-hub mapping is an upsert that does
-- nothing on conflict. So a company that already has an airport for a city
-- keeps the one it has, and running this again changes nothing.
-- ============================================================================

do $$
declare
  c       record;
  h       record;
  v_place uuid;
  v_type  text;
  v_added int := 0;
  v_map   int := 0;
begin
  for c in
    select k.id from companies k
     where exists (select 1 from te_settings s where s.company_id = k.id)
     order by k.company_name
  loop
    for h in
      select * from (values
        -- kind, city, code, short name, formal name, address, state, pin, lat, lng
        ('air','Ahmedabad','AMD','Ahmedabad airport','Sardar Vallabhbhai Patel International Airport',
         'Sardar Vallabhbhai Patel International Airport, Hansol, Ahmedabad, Gujarat 380003','Gujarat','380003',23.076396,72.631000),
        ('air','Chandigarh','IXC','Chandigarh airport','Shaheed Bhagat Singh International Airport',
         'Shaheed Bhagat Singh International Airport, Sahibzada Ajit Singh Nagar, Chandigarh 140306','Chandigarh','140306',30.667956,76.786032),
        ('air','Chennai','MAA','Chennai airport','Chennai International Airport',
         'Chennai International Airport, Airport Road, Meenambakkam, Chennai, Tamil Nadu 600044','Tamil Nadu','600044',12.993959,80.170665),
        ('air','Dehradun','DED','Dehradun airport','Jolly Grant Airport',
         'Jolly Grant Airport, Airport Road, Jauligrant, Dehradun, Uttarakhand 248016','Uttarakhand','248016',30.190940,78.184990),
        ('air','Guwahati','GAU','Guwahati airport','Lokpriya Gopinath Bordoloi International Airport',
         'Lokpriya Gopinath Bordoloi International Airport, Borjhar, Guwahati, Assam 781015','Assam','781015',26.104160,91.590149),
        ('air','Hyderabad','HYD','Hyderabad airport','Rajiv Gandhi International Airport',
         'Rajiv Gandhi International Airport, Shamshabad, Hyderabad, Telangana 500409','Telangana','500409',17.240283,78.429358),
        ('air','Indore','IDR','Indore airport','Devi Ahilyabai Holkar International Airport',
         'Devi Ahilyabai Holkar International Airport, Indore, Madhya Pradesh 452005','Madhya Pradesh','452005',22.728004,75.804099),
        ('air','Jaipur','JAI','Jaipur airport','Jaipur International Airport',
         'Jaipur International Airport, Airport Road, Sanganer, Jaipur, Rajasthan 302029','Rajasthan','302029',26.828347,75.806012),
        ('air','Kochi','COK','Kochi airport','Cochin International Airport',
         'Cochin International Airport, Nedumbassery, Ernakulam, Kerala 683111','Kerala','683111',10.153213,76.393320),
        ('air','Kolkata','CCU','Kolkata airport','Netaji Subhas Chandra Bose International Airport',
         'Netaji Subhas Chandra Bose International Airport, Dum Dum, Kolkata, West Bengal 700052','West Bengal','700052',22.653564,88.445085),
        ('air','Lucknow','LKO','Lucknow airport','Chaudhary Charan Singh International Airport',
         'Chaudhary Charan Singh International Airport, Amausi, Lucknow, Uttar Pradesh 226009','Uttar Pradesh','226009',26.761717,80.885647),
        ('air','Nagpur','NAG','Nagpur airport','Dr. Babasaheb Ambedkar International Airport',
         'Dr. Babasaheb Ambedkar International Airport, Sonegaon, Nagpur, Maharashtra 440005','Maharashtra','440005',21.090157,79.054809),
        ('air','Raipur','RPR','Raipur airport','Swami Vivekananda Airport',
         'Swami Vivekananda Airport, Nava Raipur, Raipur, Chhattisgarh 492015','Chhattisgarh','492015',21.185971,81.740279),

        ('rail','Ahmedabad','ADI','Ahmedabad Junction','Ahmedabad Junction railway station',
         'Ahmedabad Junction, Kalupur, Ahmedabad, Gujarat 380002','Gujarat','380002',23.026416,72.601148),
        ('rail','Bengaluru','SBC','Bengaluru City Junction','KSR Bengaluru City Junction railway station',
         'KSR Bengaluru City Junction, Kempegowda, Sevashrama, Bengaluru, Karnataka 560023','Karnataka','560023',12.979750,77.569237),
        ('rail','Chandigarh','CDG','Chandigarh Junction','Chandigarh Junction railway station',
         'Chandigarh Junction railway station, Daria, Chandigarh 160002','Chandigarh','160002',30.702393,76.821472),
        ('rail','Chennai','MAS','Chennai Central','Chennai Central railway station',
         'Chennai Central, Park Town, Chennai, Tamil Nadu 600003','Tamil Nadu','600003',13.083397,80.276202),
        ('rail','Dehradun','DDN','Dehradun station','Dehradun railway station',
         'Dehradun railway station, Lakkhi Bagh, Dehradun, Uttarakhand 248001','Uttarakhand','248001',30.314511,78.033619),
        ('rail','Guwahati','GHY','Guwahati station','Guwahati railway station',
         'Guwahati railway station, Paltan Bazaar, Guwahati, Assam 781008','Assam','781008',26.182263,91.751241),
        ('rail','Hyderabad','SC','Secunderabad Junction','Secunderabad Junction railway station',
         'Secunderabad Junction, Bhoiguda, Secunderabad, Telangana 500003','Telangana','500003',17.433753,78.501565),
        ('rail','Indore','INDB','Indore Junction','Indore Junction railway station',
         'Indore Junction, Chhoti Gwaltoli, Indore, Madhya Pradesh 452001','Madhya Pradesh','452001',22.717059,75.868289),
        ('rail','Kochi','ERS','Ernakulam Junction','Ernakulam Junction railway station',
         'Ernakulam Junction, Ernakulam South, Kochi, Kerala 682016','Kerala','682016',9.969238,76.290987),
        ('rail','Kolkata','HWH','Howrah Junction','Howrah Junction railway station',
         'Howrah Junction, Howrah, West Bengal 711101','West Bengal','711101',22.583946,88.343407),
        ('rail','Lucknow','LKO','Lucknow Charbagh','Lucknow Charbagh railway station',
         'Lucknow Charbagh railway station, Charbagh, Lucknow, Uttar Pradesh 226004','Uttar Pradesh','226004',26.832414,80.926541),
        ('rail','Mumbai','CSMT','Mumbai CSMT','Chhatrapati Shivaji Maharaj Terminus',
         'Chhatrapati Shivaji Maharaj Terminus, Fort, Mumbai, Maharashtra 400001','Maharashtra','400001',18.939845,72.835448),
        ('rail','Nagpur','NGP','Nagpur Junction','Nagpur Junction railway station',
         'Nagpur Junction, Sitabuldi, Nagpur, Maharashtra 440001','Maharashtra','440001',21.152306,79.088222),
        ('rail','Pune','PUNE','Pune Junction','Pune Junction railway station',
         'Pune Junction, Agarkar Nagar, Pune, Maharashtra 411001','Maharashtra','411001',18.528424,73.873865),
        ('rail','Raipur','R','Raipur Junction','Raipur Junction railway station',
         'Raipur Junction, Station Road, Raipur, Chhattisgarh 492009','Chhattisgarh','492009',21.256870,81.630117)
      ) as t(kind, city, code, short_name, name, address, state, pin, lat, lng)
    loop
      v_type := case when h.kind = 'air' then 'airport' else 'station' end;

      -- The place. Matched on the code and the kind, so a company that
      -- already has this hub under another name keeps its own.
      select p.id into v_place
        from te_places p
       where p.company_id = c.id and p.owner_employee_id is null
         and p.code = h.code and p.place_type = v_type
       limit 1;

      if v_place is null then
        insert into te_places (company_id, owner_employee_id, source, place_type,
                               short_name, name, address, city, state, pin_code, country, lat, lng, code)
        values (c.id, null, 'hub', v_type,
                h.short_name, h.name, h.address, h.city, h.state, h.pin, 'India', h.lat, h.lng, h.code)
        returning id into v_place;
        v_added := v_added + 1;
      end if;

      -- The city-to-hub mapping the engine reads. A city that already has one
      -- of this kind keeps it: an administrator's choice is not overwritten.
      insert into te_hubs (company_id, area, kind, place_id)
      values (c.id, h.city, h.kind, v_place)
      on conflict (company_id, area, kind) do nothing;
      if found then v_map := v_map + 1; end if;
    end loop;
  end loop;

  raise notice 'te hubs: % places added, % city mappings written', v_added, v_map;
end $$;

notify pgrst, 'reload schema';
