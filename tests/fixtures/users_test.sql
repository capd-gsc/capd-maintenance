-- Fictional test users (same roles as the real team; no real names or emails)
insert into public.app_users(email, full_name, role, fd_type, is_admin, memo_approver) values
  ('user01@scg.com','User 01','member',null,true,false),
  ('user02@scg.com','User 02','foreman_day','เครื่องจักร',false,false),
  ('user03@scg.com','User 03','foreman_day','เครื่องทดสอบ',false,false),
  ('user04@scg.com','User 04','foreman_day',null,false,false),
  ('user05@scg.com','User 05','foreman_shift',null,false,false),
  ('user06@scg.com','User 06','foreman_shift',null,false,false),
  ('user07@scg.com','User 07','foreman_shift',null,false,false),
  ('user08@scg.com','User 08','foreman_shift',null,false,false),
  ('user09@scg.com','User 09','manager',null,false,true),
  ('user10@scg.com','User 10','manager',null,false,true),
  ('user11@scg.com','User 11','member',null,false,false),
  ('user12@scg.com','User 12','member',null,false,false),
  ('user13@scg.com','User 13','member',null,false,false),
  ('user14@scg.com','User 14','member',null,false,false),
  ('user15@scg.com','User 15','member',null,false,false),
  ('user16@scg.com','User 16','member',null,false,false),
  ('user17@scg.com','User 17','member',null,false,false),
  ('user18@scg.com','User 18','member',null,false,false),
  ('user19@scg.com','User 19','member',null,false,false),
  ('user20@scg.com','User 20','member',null,false,false),
  ('user21@scg.com','User 21','member',null,false,false)
on conflict (email) do nothing;
