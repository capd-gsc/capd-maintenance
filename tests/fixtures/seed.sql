insert into machines(machine_no, machine_name, machine_type, location, responsibility, maintenance_type, pm_last_date, pm_interval_month, cal_last_date, cal_interval_month) values
 ('M-01','Twin Screw Extruder','เครื่องจักร','Extruder Area (Line 91)','user14@scg.com','PM', current_date - interval '11 months', 12, null, null),
 ('T-01','UTM Tester','เครื่องทดสอบ','Testing Room 1','user21@scg.com','CAL', null, null, current_date - interval '10 months', 12),
 ('MD-01','Mvss 2 mm','Mold','Injection Area MTD','user01@scg.com','No Plan', null, null, null, null);
