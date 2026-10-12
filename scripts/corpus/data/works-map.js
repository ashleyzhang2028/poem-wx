/* ==========================================================================
   同篇对照表（主表裁定规则的静态成果）
   --------------------------------------------------------------------------
   由 scripts/build-works-map.js 离线算出：**正文（去标点后）一致 = 同一篇作品**。
   只登记「在两部及以上集子里重复出现」的那些作品（共 239 组），
   单条的作品不必登记 —— 它本来就只出现一次，条目 id 自己就是作品 id。

   ⚠️ 这是**生成文件**，改动请改 scripts/build-works-map.js 后重跑，
      不要手改这里 —— 下次重新生成会把手工改动覆盖掉。

   为什么要单独落成一份**静态数据**而不是每页现算：
     现算要先备齐九部集子的全部数据（约 3MB）。集子索引页只加载自己那一部，
     它也要判重（「这篇是不是已经在课内背过了」），现算就会得到一张残表。
     这一份 8KB，任何页面都能引，判重口径全站一致。

   ## 为什么不是所有同名篇目都合并

   教材与选本的文本**真会不一样**，是文献上的差别、不是录入出错：
     · 《静夜思》 教材与《唐诗》正文一致（都是「床前明月光」的教材文本）
       → 合并为同一篇（titles 记两个题名）
     · 《陋室铭》 教材作「孔子云何陋之有」、古文观止作「孔子云『何陋之有』」→ 引号剥掉后
       正文一致，合并
     · 《夜上受降城闻笛》 教材作「回乐烽」、唐诗作「回乐峰」→ 一字之差，是两种文本，
       **分成两条并列的作品**，各背各的
   规则一句话：**课内以教材文本为准，选集以选本原貌为准，冲突时分两条并列**。

   至于同一篇作品「用哪一份正文」，那是另一份静态表的裁定 ——
   见 data/canonical-texts.js（课内优先，同一篇只留一份正文）。

   ## 课内自身重复已按「低年级版本为准」去重

   课内数据里曾有 12 组篇目在两个年级各存一份（正文一字不差），是逐页录入留下的
   自身重复（《绝句》二年级下 / 三年级下、《师说》高一上 / 高三下……）。
   已各删一条、保留低年级那条，课内条目由 273 降到 261，本表组数由 66 降到 57。
   跨集那 3 组只删课内自身那份，与选集的判重照旧。

   字段：
     wid     作品 id（`w-` 加首个条目 id）
     title   主条目题名（有课内条目时取教材题名）
     titles  这一篇出现过的全部题名（同诗异题：《夜思》与《静夜思》）
     entries 收录这一篇的全部站点条目 id，与 data/site-index.js 同口径
   ========================================================================== */
window.WORKS_GROUPS = [
  { wid: "w-classic-gw-39", title: "狐假虎威", titles: ["狐假虎威"], entries: ["chengyu-cy-114","classic-gw-39"] },
  { wid: "w-classic-gw-25", title: "画蛇添足", titles: ["画蛇添足"], entries: ["chengyu-cy-115","classic-gw-25","classic-gw-284"] },
  { wid: "w-classic-gw-11", title: "自相矛盾", titles: ["自相矛盾"], entries: ["chengyu-cy-119","classic-gw-11"] },
  { wid: "w-classic-gw-33", title: "滥竽充数", titles: ["滥竽充数","滥竽充数（一）"], entries: ["chengyu-cy-120","classic-gw-33","classic-gw-254","classic-gw-271"] },
  { wid: "w-classic-gw-76", title: "邯郸学步", titles: ["邯郸学步","邯郸学步（一）"], entries: ["chengyu-cy-122","classic-gw-76","classic-gw-256","classic-gw-273"] },
  { wid: "w-classic-gw-26", title: "刻舟求剑", titles: ["刻舟求剑","刻舟求剑（一）"], entries: ["chengyu-cy-123","classic-gw-26","classic-gw-255","classic-gw-272"] },
  { wid: "w-chengyu-cy-130", title: "蚌鹬相持", titles: ["蚌鹬相持","坐收渔利"], entries: ["chengyu-cy-130","chengyu-cy-622"] },
  { wid: "w-classic-gw-21", title: "鲧禹治水", titles: ["鲧禹治水"], entries: ["chengyu-cy-14","classic-gw-21"] },
  { wid: "w-chengyu-cy-155", title: "贻笑大方", titles: ["贻笑大方","大方之家"], entries: ["chengyu-cy-155","chengyu-cy-200"] },
  { wid: "w-classic-gw-32", title: "揠苗助长", titles: ["揠苗助长"], entries: ["chengyu-cy-188","classic-gw-32"] },
  { wid: "w-classic-gw-19", title: "夸父逐日", titles: ["夸父逐日"], entries: ["chengyu-cy-2","classic-gw-19"] },
  { wid: "w-classic-gw-201", title: "歧路亡羊", titles: ["牧竖拾金分心","歧路亡羊"], entries: ["chengyu-cy-213","classic-gw-201"] },
  { wid: "w-chengyu-cy-244", title: "运筹帷幄", titles: ["运筹帷幄","决胜千里"], entries: ["chengyu-cy-244","chengyu-cy-245"] },
  { wid: "w-chengyu-cy-276", title: "解衣推食", titles: ["解衣推食","言听计从"], entries: ["chengyu-cy-276","chengyu-cy-606"] },
  { wid: "w-chengyu-cy-283", title: "鸿鹄之志", titles: ["鸿鹄之志","燕雀安知鸿鹄之志"], entries: ["chengyu-cy-283","chengyu-cy-286"] },
  { wid: "w-classic-gw-5", title: "精卫填海", titles: ["精卫填海"], entries: ["chengyu-cy-3","classic-gw-5"] },
  { wid: "w-chengyu-cy-327", title: "桃李不言", titles: ["桃李不言","桃李成蹊"], entries: ["chengyu-cy-327","chengyu-cy-697"] },
  { wid: "w-classic-gw-46", title: "望梅止渴", titles: ["望梅止渴"], entries: ["chengyu-cy-341","classic-gw-46"] },
  { wid: "w-chengyu-cy-404", title: "梦笔生花", titles: ["梦笔生花","妙笔生花"], entries: ["chengyu-cy-404","chengyu-cy-439"] },
  { wid: "w-yuefu-yf-96", title: "人面桃花", titles: ["题都城南庄","人面桃花"], entries: ["chengyu-cy-440","tangshi-ts-313","yuefu-yf-96"] },
  { wid: "w-tangshi-ts-276", title: "淡扫蛾眉", titles: ["集灵台·其二","淡扫蛾眉"], entries: ["chengyu-cy-465","tangshi-ts-276"] },
  { wid: "w-chengyu-cy-471", title: "春风得意", titles: ["春风得意","走马看花"], entries: ["chengyu-cy-471","chengyu-cy-472"] },
  { wid: "w-poems-xx5-12", title: "寸草春晖", titles: ["游子吟","寸草春晖"], entries: ["chengyu-cy-475","poems-xx5-12","tangshi-ts-67","yuefu-yf-48"] },
  { wid: "w-classic-gw-244", title: "一字之师", titles: ["一字师","一字之师"], entries: ["chengyu-cy-478","classic-gw-244"] },
  { wid: "w-chengyu-cy-504", title: "近水楼台", titles: ["近水楼台","近水楼台先得月"], entries: ["chengyu-cy-504","chengyu-cy-524"] },
  { wid: "w-classic-gw-48", title: "卧薪尝胆", titles: ["卧薪尝胆"], entries: ["chengyu-cy-52","classic-gw-48"] },
  { wid: "w-classic-gw-190", title: "只许州官放火不许百姓点灯", titles: ["只许州官放火","只许州官放火不许百姓点灯"], entries: ["chengyu-cy-523","classic-gw-190"] },
  { wid: "w-tangshi-ts-281", title: "折戟沉沙", titles: ["赤壁","折戟沉沙"], entries: ["chengyu-cy-573","tangshi-ts-281"] },

  { wid: "w-classic-gw-107", title: "狼", titles: ["狼","黠狼"], entries: ["classic-gw-107","classic-gw-226"] },
  { wid: "w-classic-gw-112", title: "庄子钓于濮水", titles: ["庄子钓于濮水","神龟"], entries: ["classic-gw-112","classic-gw-227"] },
  { wid: "w-classic-gw-115", title: "师说", titles: ["师说"], entries: ["classic-gw-115","guwen-gwj-232"] },
  { wid: "w-classic-gw-116", title: "六国论", titles: ["六国论"], entries: ["classic-gw-116","guwen-gwj-233"] },
  { wid: "w-classic-gw-117", title: "游褒禅山记", titles: ["游褒禅山记"], entries: ["classic-gw-117","guwen-gwj-234"] },
  { wid: "w-classic-gw-118", title: "伶官传序", titles: ["伶官传序","五代史伶官传序"], entries: ["classic-gw-118","guwen-gwj-123"] },
  { wid: "w-classic-gw-12", title: "杨氏之子", titles: ["杨氏之子","杨氏之子（一）"], entries: ["classic-gw-12","classic-gw-260"] },
  { wid: "w-classic-gw-123", title: "齐桓晋文之事", titles: ["齐桓晋文之事"], entries: ["classic-gw-123","guwen-gwj-156"] },
  { wid: "w-poems-gz12-17", title: "子路、曾皙、冉有、公西华侍坐", titles: ["子路曾皙冉有公西华侍坐","子路、曾皙、冉有、公西华侍坐"], entries: ["classic-gw-124","poems-gz12-17"] },
  { wid: "w-classic-gw-128", title: "上枢密韩太尉书", titles: ["上枢密韩太尉书"], entries: ["classic-gw-128","guwen-gwj-235"] },
  { wid: "w-classic-gw-132", title: "枭逢鸠", titles: ["枭逢鸠"], entries: ["classic-gw-132","classic-gw-208"] },
  { wid: "w-classic-gw-139", title: "大铁椎传", titles: ["大铁椎传"], entries: ["classic-gw-139","guwen-gwj-231"] },
  { wid: "w-classic-gw-14", title: "书戴嵩画牛", titles: ["书戴嵩画牛","书戴嵩画牛（一）"], entries: ["classic-gw-14","classic-gw-264"] },
  { wid: "w-classic-gw-15", title: "学弈", titles: ["学弈","学弈（一）"], entries: ["classic-gw-15","classic-gw-261"] },
  { wid: "w-classic-gw-150", title: "五柳先生传", titles: ["五柳先生传"], entries: ["classic-gw-150","guwen-gwj-89"] },
  { wid: "w-classic-gw-154", title: "塞翁失马", titles: ["塞翁失马","塞翁失马（一）"], entries: ["classic-gw-154","classic-gw-267"] },
  { wid: "w-classic-gw-184", title: "拔苗助长", titles: ["拔苗助长","揠苗助长","揠苗助长（一）"], entries: ["classic-gw-184","classic-gw-258","classic-gw-275"] },
  { wid: "w-classic-gw-22", title: "共工怒触不周山", titles: ["共工怒触不周山","共工怒触不周山（一）"], entries: ["classic-gw-22","classic-gw-266"] },
  { wid: "w-classic-gw-24", title: "掩耳盗铃", titles: ["掩耳盗铃","掩耳盗钟","掩耳盗钟（一）"], entries: ["classic-gw-24","classic-gw-202","classic-gw-276"] },
  { wid: "w-classic-gw-248", title: "北人食菱", titles: ["北人食菱","北人食菱（一）"], entries: ["classic-gw-248","classic-gw-268"] },
  { wid: "w-classic-gw-250", title: "铁杵成针", titles: ["铁杵成针","铁杵成针（一）"], entries: ["classic-gw-250","classic-gw-265"] },
  { wid: "w-classic-gw-27", title: "郑人买履", titles: ["郑人买履","郑人买履（一）"], entries: ["classic-gw-27","classic-gw-252","classic-gw-269"] },
  { wid: "w-classic-gw-278", title: "郑板桥教子", titles: ["郑板桥教子","郑板桥教子（古文观止本）","潍县署中与舍弟墨第二书"], entries: ["classic-gw-278","classic-gw-287","guwen-gw-287","guwen-gwj-236"] },
  { wid: "w-classic-gw-285", title: "心术", titles: ["心术"], entries: ["classic-gw-285","guwen-gw-285","guwen-gwj-202"] },
  { wid: "w-classic-gw-3", title: "司马光", titles: ["司马光","司马光（一）"], entries: ["classic-gw-3","classic-gw-262"] },
  { wid: "w-classic-gw-35", title: "画龙点睛", titles: ["画龙点睛"], entries: ["classic-gw-35","classic-gw-180"] },
  { wid: "w-classic-gw-37", title: "鹬蚌相争", titles: ["鹬蚌相争","鹬蚌相争（一）"], entries: ["classic-gw-37","classic-gw-253","classic-gw-270"] },
  { wid: "w-classic-gw-40", title: "螳螂捕蝉", titles: ["螳螂捕蝉"], entries: ["classic-gw-40","classic-gw-251"] },
  { wid: "w-classic-gw-45", title: "薛谭学讴", titles: ["薛谭学讴","响遏行云"], entries: ["classic-gw-45","classic-gw-225"] },
  { wid: "w-classic-gw-54", title: "管宁割席", titles: ["管宁割席","割席分坐"], entries: ["classic-gw-54","classic-gw-178"] },
  { wid: "w-classic-gw-57", title: "凿壁借光", titles: ["凿壁借光","匡衡凿壁借光"], entries: ["classic-gw-57","classic-gw-177"] },
  { wid: "w-classic-gw-6", title: "王戎不取道旁李", titles: ["王戎不取道旁李","王戎早慧","王戎不取道旁李（一）"], entries: ["classic-gw-6","classic-gw-179","classic-gw-259"] },
  { wid: "w-poems-cz8-02", title: "答谢中书书", titles: ["答谢中书书"], entries: ["classic-gw-60","poems-cz8-02"] },
  { wid: "w-classic-gw-7", title: "囊萤夜读", titles: ["囊萤夜读","囊萤夜读（一）"], entries: ["classic-gw-7","classic-gw-263"] },
  { wid: "w-classic-gw-78", title: "日攘一鸡", titles: ["日攘一鸡","偷鸡者辩解"], entries: ["classic-gw-78","classic-gw-228"] },
  { wid: "w-classic-gw-80", title: "执竿入城", titles: ["执竿入城","锯竿入城","长竿入城","长竿入城（一）"], entries: ["classic-gw-80","classic-gw-207","classic-gw-257","classic-gw-274"] },
  { wid: "w-classic-gw-81", title: "约不可失", titles: ["约不可失","魏文侯期猎"], entries: ["classic-gw-81","classic-gw-224"] },
  { wid: "w-classic-gw-89", title: "陶母责子", titles: ["陶母责子"], entries: ["classic-gw-89","classic-gw-181"] },
  { wid: "w-classic-gw-94", title: "子罕辞玉", titles: ["子罕辞玉","子罕弗受玉"], entries: ["classic-gw-94","classic-gw-152"] },

  { wid: "w-yuefu-yf-2", title: "垓下歌", titles: ["垓下歌"], entries: ["gushi-gs-111","yuefu-yf-2"] },
  { wid: "w-poems-gz10-02", title: "短歌行", titles: ["短歌行"], entries: ["gushi-gs-112","poems-gz10-02","yuefu-yf-11"] },
  { wid: "w-poems-xx3-03", title: "赠刘景文", titles: ["赠刘景文"], entries: ["gushi-gs-125","poems-xx3-03"] },
  { wid: "w-gushi-gs-44", title: "赠范晔诗", titles: ["赠范晔诗"], entries: ["gushi-gs-44","gushi-gs-63","gushi-gs-109"] },
  { wid: "w-poems-gz10-23", title: "书愤", titles: ["书愤"], entries: ["gushi-gs-45","poems-gz10-23"] },
  { wid: "w-poems-gz10-24", title: "临安春雨初霁", titles: ["临安春雨初霁"], entries: ["gushi-gs-46","poems-gz10-24"] },
  { wid: "w-gushi-gs-51", title: "鹊桥仙·华灯纵博", titles: ["鹊桥仙·华灯纵博","鹊桥仙"], entries: ["gushi-gs-51","songci-sc-281"] },
  { wid: "w-tangshi-ts-389", title: "闲居初夏午睡起二首·其一", titles: ["庭竹","闲居初夏午睡起·其一","闲居初夏午睡起二首·其一"], entries: ["gushi-gs-55","tangshi-ts-389","tangshi-ts-390"] },
  { wid: "w-poems-xx2-07", title: "敕勒歌", titles: ["敕勒歌"], entries: ["gushi-gs-62","poems-xx2-07","yuefu-yf-18"] },
  { wid: "w-poems-xx6-11", title: "游园不值", titles: ["游园不值"], entries: ["gushi-gs-64","poems-xx6-11"] },
  { wid: "w-poems-xx4-06", title: "绝句", titles: ["夏日绝句","绝句"], entries: ["gushi-gs-65","poems-xx4-06"] },
  { wid: "w-poems-xx6-19", title: "春日", titles: ["春日"], entries: ["gushi-gs-66","poems-xx6-19"] },
  { wid: "w-poems-xx3-14", title: "元日", titles: ["元日"], entries: ["gushi-gs-67","poems-xx3-14"] },
  { wid: "w-poems-xx6-29", title: "泊船瓜洲", titles: ["泊船瓜洲"], entries: ["gushi-gs-68","poems-xx6-29"] },
  { wid: "w-poems-xx6-15", title: "竹石", titles: ["竹石"], entries: ["gushi-gs-69","poems-xx6-15"] },
  { wid: "w-poems-xx4-15", title: "墨梅", titles: ["墨梅"], entries: ["gushi-gs-70","poems-xx4-15"] },
  { wid: "w-poems-xx6-28", title: "江上渔者", titles: ["江上渔者"], entries: ["gushi-gs-71","poems-xx6-28"] },
  { wid: "w-poems-cz7-11", title: "山中杂诗", titles: ["十一月四日风雨大作（其二）","山中杂诗","十一月四日风雨大作·其二"], entries: ["gushi-gs-75","gushi-gs-82","poems-cz7-11"] },
  { wid: "w-poems-cz7-12", title: "画眉鸟", titles: ["潼关","画眉鸟"], entries: ["gushi-gs-76","gushi-gs-83","poems-cz7-12"] },
  { wid: "w-poems-cz7-20", title: "蚕妇吟", titles: ["登飞来峰","蚕妇吟"], entries: ["gushi-gs-77","gushi-gs-84","poems-cz7-20"] },
  { wid: "w-gushi-gs-78", title: "蚕妇", titles: ["蚕妇"], entries: ["gushi-gs-78","gushi-gs-126"] },
  { wid: "w-gushi-gs-79", title: "论诗", titles: ["论诗","论诗五绝·其二"], entries: ["gushi-gs-79","gushi-gs-117"] },
  { wid: "w-poems-xx6-21", title: "读《岳阳楼记》", titles: ["过零丁洋","读《岳阳楼记》"], entries: ["gushi-gs-80","gushi-gs-87","poems-xx6-21"] },
  { wid: "w-poems-cz9-26", title: "天平山中", titles: ["南安军","天平山中"], entries: ["gushi-gs-81","gushi-gs-88","poems-cz9-26"] },
  { wid: "w-poems-cz7-21", title: "游山西村", titles: ["游山西村"], entries: ["gushi-gs-85","poems-cz7-21"] },
  { wid: "w-poems-cz7-22", title: "己亥杂诗·其五", titles: ["己亥杂诗（其五）","己亥杂诗·其五"], entries: ["gushi-gs-86","poems-cz7-22"] },
  { wid: "w-poems-gz10-03", title: "归园田居·其一", titles: ["归园田居（其一）","归园田居·其一"], entries: ["gushi-gs-93","poems-gz10-03"] },

  { wid: "w-poems-cz9-05", title: "醉翁亭记", titles: ["醉翁亭记"], entries: ["guwen-gwj-127","poems-cz9-05"] },
  { wid: "w-poems-gz10-12", title: "前赤壁赋", titles: ["赤壁赋","前赤壁赋"], entries: ["guwen-gwj-139","poems-gz10-12"] },
  { wid: "w-poems-cz9-06", title: "湖心亭看雪", titles: ["湖心亭看雪"], entries: ["guwen-gwj-221","poems-cz9-06"] },
  { wid: "w-poems-gz11-08", title: "屈原列传", titles: ["屈原列传"], entries: ["guwen-gwj-70","poems-gz11-08"] },
  { wid: "w-guwen-gwj-77", title: "过秦论（上）", titles: ["过秦论（上）","过秦论上"], entries: ["guwen-gwj-77","guwen-gwj-167"] },
  { wid: "w-guwen-gwj-78", title: "治安策", titles: ["治安策","治安策一"], entries: ["guwen-gwj-78","guwen-gwj-168"] },
  { wid: "w-guwen-gwj-81", title: "司马相如上书谏猎", titles: ["司马相如上书谏猎","上书谏猎"], entries: ["guwen-gwj-81","guwen-gwj-169"] },
  { wid: "w-poems-gz11-15", title: "陈情表", titles: ["陈情表"], entries: ["guwen-gwj-85","poems-gz11-15"] },
  { wid: "w-poems-gz11-16", title: "归去来兮辞", titles: ["归去来兮辞"], entries: ["guwen-gwj-87","poems-gz11-16"] },
  { wid: "w-poems-cz8-14", title: "桃花源记", titles: ["桃花源记"], entries: ["guwen-gwj-88","poems-cz8-14"] },
  { wid: "w-poems-gz10-20", title: "谏太宗十思疏", titles: ["谏太宗十思疏"], entries: ["guwen-gwj-91","poems-gz10-20"] },
  { wid: "w-poems-gz12-15", title: "滕王阁序", titles: ["滕王阁序"], entries: ["guwen-gwj-93","poems-gz12-15"] },
  { wid: "w-guwen-gwj-95", title: "春夜宴桃李园序", titles: ["春夜宴桃李园序","春夜宴从弟桃花园序"], entries: ["guwen-gwj-95","guwen-gwj-170"] },
  { wid: "w-poems-cz7-23", title: "陋室铭", titles: ["陋室铭"], entries: ["guwen-gwj-97","poems-cz7-23"] },
  { wid: "w-poems-gz10-19", title: "阿房宫赋", titles: ["阿房宫赋"], entries: ["guwen-gwj-98","poems-gz10-19"] },

  { wid: "w-poems-gz10-01", title: "沁园春·长沙", titles: ["沁园春·长沙"], entries: ["jinxiandai-jxd-01","poems-gz10-01"] },
  { wid: "w-poems-xx6-18", title: "七律·长征", titles: ["七律·长征"], entries: ["jinxiandai-jxd-05","poems-xx6-18"] },
  { wid: "w-poems-cz9-01", title: "沁园春·雪", titles: ["沁园春·雪"], entries: ["jinxiandai-jxd-07","poems-cz9-01"] },
  { wid: "w-poems-xx4-11", title: "卜算子·咏梅", titles: ["卜算子·咏梅"], entries: ["jinxiandai-jxd-11","poems-xx4-11"] },

  { wid: "w-poems-cz7-01", title: "观沧海", titles: ["观沧海"], entries: ["poems-cz7-01","yuefu-yf-12"] },
  { wid: "w-poems-cz7-02", title: "闻王昌龄左迁龙标遥有此寄", titles: ["闻王昌龄左迁龙标遥有此寄"], entries: ["poems-cz7-02","tangshi-ts-413"] },
  { wid: "w-poems-cz7-03", title: "次北固山下", titles: ["次北固山下"], entries: ["poems-cz7-03","tangshi-ts-102"] },
  { wid: "w-poems-cz7-05", title: "峨眉山月歌", titles: ["峨眉山月歌"], entries: ["poems-cz7-05","yuefu-yf-65"] },
  { wid: "w-poems-cz7-06", title: "江南逢李龟年", titles: ["江南逢李龟年"], entries: ["poems-cz7-06","tangshi-ts-262","yuefu-yf-83"] },
  { wid: "w-poems-cz7-07", title: "行军九日思长安故园", titles: ["行军九日思长安故园"], entries: ["poems-cz7-07","tangshi-ts-414"] },
  { wid: "w-poems-cz7-08", title: "夜上受降城闻笛", titles: ["夜上受降城闻笛"], entries: ["poems-cz7-08","tangshi-ts-270"] },
  { wid: "w-poems-cz7-09", title: "秋词（其一）", titles: ["秋词（其一）","秋词"], entries: ["poems-cz7-09","yuefu-yf-54"] },
  { wid: "w-poems-cz7-10", title: "夜雨寄北", titles: ["夜雨寄北"], entries: ["poems-cz7-10","tangshi-ts-295"] },
  { wid: "w-poems-cz7-13", title: "木兰诗", titles: ["木兰诗"], entries: ["poems-cz7-13","yuefu-yf-17"] },
  { wid: "w-poems-cz7-14", title: "竹里馆", titles: ["竹里馆"], entries: ["poems-cz7-14","tangshi-ts-223"] },
  { wid: "w-poems-cz7-15", title: "春夜洛城闻笛", titles: ["春夜洛城闻笛"], entries: ["poems-cz7-15","tangshi-ts-415"] },
  { wid: "w-poems-cz7-16", title: "逢入京使", titles: ["逢入京使"], entries: ["poems-cz7-16","tangshi-ts-261"] },
  { wid: "w-poems-cz7-17", title: "晚春", titles: ["晚春"], entries: ["poems-cz7-17","tangshi-ts-416"] },
  { wid: "w-poems-cz7-18", title: "登幽州台歌", titles: ["登幽州台歌"], entries: ["poems-cz7-18","tangshi-ts-34"] },
  { wid: "w-poems-cz7-19", title: "望岳", titles: ["望岳"], entries: ["poems-cz7-19","tangshi-ts-6"] },
  { wid: "w-poems-cz8-05", title: "野望", titles: ["野望"], entries: ["poems-cz8-05","tangshi-ts-444"] },
  { wid: "w-poems-cz8-06", title: "黄鹤楼", titles: ["黄鹤楼"], entries: ["poems-cz8-06","tangshi-ts-173"] },
  { wid: "w-poems-cz8-07", title: "使至塞上", titles: ["使至塞上"], entries: ["poems-cz8-07","tangshi-ts-417"] },
  { wid: "w-poems-cz8-08", title: "渡荆门送别", titles: ["渡荆门送别"], entries: ["poems-cz8-08","tangshi-ts-106"] },
  { wid: "w-poems-cz8-09", title: "钱塘湖春行", titles: ["钱塘湖春行"], entries: ["poems-cz8-09","tangshi-ts-418"] },
  { wid: "w-poems-cz8-11", title: "龟虽寿", titles: ["龟虽寿"], entries: ["poems-cz8-11","yuefu-yf-13"] },
  { wid: "w-poems-cz8-21", title: "送杜少府之任蜀州", titles: ["送杜少府之任蜀州"], entries: ["poems-cz8-21","tangshi-ts-97"] },
  { wid: "w-poems-cz8-22", title: "望洞庭湖赠张丞相", titles: ["望洞庭湖赠张丞相","临洞庭上张丞相"], entries: ["poems-cz8-22","tangshi-ts-128"] },
  { wid: "w-poems-cz8-23", title: "石壕吏", titles: ["石壕吏"], entries: ["poems-cz8-23","yuefu-yf-78"] },
  { wid: "w-poems-cz8-24", title: "茅屋为秋风所破歌", titles: ["茅屋为秋风所破歌"], entries: ["poems-cz8-24","yuefu-yf-79"] },
  { wid: "w-poems-cz8-25", title: "卖炭翁", titles: ["卖炭翁"], entries: ["poems-cz8-25","tangshi-ts-420"] },
  { wid: "w-poems-cz8-26", title: "题破山寺后禅院", titles: ["题破山寺后禅院"], entries: ["poems-cz8-26","tangshi-ts-421"] },
  { wid: "w-poems-cz8-27", title: "送友人", titles: ["送友人"], entries: ["poems-cz8-27","tangshi-ts-107"] },
  { wid: "w-poems-cz8-28", title: "卜算子·黄州定慧院寓居作", titles: ["卜算子·黄州定慧院寓居作","卜算子·黄州定惠院寓居作"], entries: ["poems-cz8-28","songci-sc-70"] },
  { wid: "w-poems-cz8-29", title: "卜算子·咏梅", titles: ["卜算子·咏梅"], entries: ["poems-cz8-29","songci-sc-173"] },
  { wid: "w-poems-cz9-07", title: "行路难（其一）", titles: ["行路难（其一）","行路难","行路难·其一"], entries: ["poems-cz9-07","tangshi-ts-77","yuefu-yf-37"] },
  { wid: "w-poems-cz9-08", title: "酬乐天扬州初逢席上见赠", titles: ["酬乐天扬州初逢席上见赠"], entries: ["poems-cz9-08","tangshi-ts-422"] },
  { wid: "w-poems-cz9-10", title: "月夜忆舍弟", titles: ["月夜忆舍弟"], entries: ["poems-cz9-10","tangshi-ts-114"] },
  { wid: "w-poems-cz9-11", title: "长沙过贾谊宅", titles: ["长沙过贾谊宅"], entries: ["poems-cz9-11","tangshi-ts-200"] },
  { wid: "w-poems-cz9-12", title: "左迁至蓝关示侄孙湘", titles: ["左迁至蓝关示侄孙湘"], entries: ["poems-cz9-12","tangshi-ts-423"] },
  { wid: "w-poems-cz9-13", title: "商山早行", titles: ["商山早行"], entries: ["poems-cz9-13","tangshi-ts-424"] },
  { wid: "w-poems-cz9-14", title: "咸阳城东楼", titles: ["咸阳城东楼"], entries: ["poems-cz9-14","tangshi-ts-425"] },
  { wid: "w-poems-cz9-18", title: "渔家傲·秋思", titles: ["渔家傲·秋思","渔家傲"], entries: ["poems-cz9-18","songci-sc-5"] },
  { wid: "w-poems-cz9-23", title: "临江仙·夜登小阁忆洛中旧游", titles: ["临江仙·夜登小阁忆洛中旧游","临江仙"], entries: ["poems-cz9-23","songci-sc-147"] },
  { wid: "w-poems-cz9-28", title: "山坡羊·骊山怀古", titles: ["山坡羊·骊山怀古"], entries: ["poems-cz9-28","yuanqu-yq-3"] },
  { wid: "w-poems-cz9-29", title: "朝天子·咏喇叭", titles: ["朝天子·咏喇叭"], entries: ["poems-cz9-29","yuanqu-yq-11"] },
  { wid: "w-poems-gz10-04", title: "梦游天姥吟留别", titles: ["梦游天姥吟留别"], entries: ["poems-gz10-04","tangshi-ts-41"] },
  { wid: "w-poems-gz10-05", title: "登高", titles: ["登高"], entries: ["poems-gz10-05","tangshi-ts-190"] },
  { wid: "w-poems-gz10-06", title: "琵琶行并序", titles: ["琵琶行并序","琵琶行·并序"], entries: ["poems-gz10-06","tangshi-ts-59"] },
  { wid: "w-poems-gz10-07", title: "念奴娇·赤壁怀古", titles: ["念奴娇·赤壁怀古"], entries: ["poems-gz10-07","songci-sc-67"] },
  { wid: "w-poems-gz10-08", title: "永遇乐·京口北固亭怀古", titles: ["永遇乐·京口北固亭怀古"], entries: ["poems-gz10-08","songci-sc-183"] },
  { wid: "w-poems-gz10-09", title: "声声慢·寻寻觅觅", titles: ["声声慢·寻寻觅觅","声声慢"], entries: ["poems-gz10-09","songci-sc-249"] },
  { wid: "w-poems-gz10-13", title: "涉江采芙蓉", titles: ["涉江采芙蓉"], entries: ["poems-gz10-13","yuefu-yf-10"] },
  { wid: "w-poems-gz10-16", title: "虞美人·春花秋月何时了", titles: ["虞美人·春花秋月何时了","虞美人"], entries: ["poems-gz10-16","yuefu-yf-57"] },
  { wid: "w-poems-gz10-18", title: "桂枝香·金陵怀古", titles: ["桂枝香·金陵怀古","桂枝香"], entries: ["poems-gz10-18","songci-sc-47"] },
  { wid: "w-poems-gz10-21", title: "登岳阳楼", titles: ["登岳阳楼"], entries: ["poems-gz10-21","tangshi-ts-119"] },
  { wid: "w-poems-gz11-06", title: "将进酒", titles: ["将进酒"], entries: ["poems-gz11-06","tangshi-ts-78","yuefu-yf-36"] },
  { wid: "w-poems-gz11-07", title: "江城子·乙卯正月二十日夜记梦", titles: ["江城子·乙卯正月二十日夜记梦"], entries: ["poems-gz11-07","songci-sc-75"] },
  { wid: "w-poems-gz11-09", title: "过秦论", titles: ["过秦论"], entries: ["poems-gz11-09","zhaoming-zm-437"] },
  { wid: "w-poems-gz11-10", title: "燕歌行并序", titles: ["燕歌行并序","燕歌行·并序"], entries: ["poems-gz11-10","tangshi-ts-72"] },
  { wid: "w-poems-gz11-12", title: "锦瑟", titles: ["锦瑟"], entries: ["poems-gz11-12","tangshi-ts-213"] },
  { wid: "w-poems-gz11-14", title: "蜀道难", titles: ["蜀道难"], entries: ["poems-gz11-14","tangshi-ts-74","yuefu-yf-35"] },
  { wid: "w-poems-gz11-19", title: "扬州慢·淮左名都", titles: ["扬州慢·淮左名都","扬州慢"], entries: ["poems-gz11-19","songci-sc-192"] },
  { wid: "w-poems-gz11-20", title: "客至", titles: ["客至"], entries: ["poems-gz11-20","tangshi-ts-187"] },
  { wid: "w-poems-xx1-02", title: "江南", titles: ["江南"], entries: ["poems-xx1-02","yuefu-yf-4"] },
  { wid: "w-poems-xx1-07", title: "春晓", titles: ["春晓"], entries: ["poems-xx1-07","tangshi-ts-230"] },
  { wid: "w-poems-xx1-08", title: "赠汪伦", titles: ["赠汪伦"], entries: ["poems-xx1-08","yuefu-yf-67"] },
  { wid: "w-poems-xx1-09", title: "静夜思", titles: ["静夜思","夜思"], entries: ["poems-xx1-09","tangshi-ts-231","yuefu-yf-63"] },
  { wid: "w-poems-xx1-10", title: "寻隐者不遇", titles: ["寻隐者不遇"], entries: ["poems-xx1-10","tangshi-ts-247"] },
  { wid: "w-poems-xx2-03", title: "登鹳雀楼", titles: ["登鹳雀楼"], entries: ["poems-xx2-03","tangshi-ts-234"] },
  { wid: "w-poems-xx2-04", title: "望庐山瀑布", titles: ["望庐山瀑布"], entries: ["poems-xx2-04","yuefu-yf-66"] },
  { wid: "w-poems-xx2-05", title: "江雪", titles: ["江雪"], entries: ["poems-xx2-05","tangshi-ts-242"] },
  { wid: "w-poems-xx2-10", title: "赋得古原草送别", titles: ["赋得古原草送别","草"], entries: ["poems-xx2-10","tangshi-ts-156"] },
  { wid: "w-poems-xx3-02", title: "山行", titles: ["山行"], entries: ["poems-xx3-02","tangshi-ts-394"] },
  { wid: "w-poems-xx3-05", title: "望天门山", titles: ["望天门山"], entries: ["poems-xx3-05","yuefu-yf-71"] },
  { wid: "w-poems-xx3-08", title: "早发白帝城", titles: ["早发白帝城"], entries: ["poems-xx3-08","tangshi-ts-260","yuefu-yf-69"] },
  { wid: "w-poems-xx3-09", title: "采莲曲", titles: ["采莲曲"], entries: ["poems-xx3-09","tangshi-ts-89"] },
  { wid: "w-poems-xx3-13", title: "忆江南", titles: ["忆江南","忆江南·其一"], entries: ["poems-xx3-13","tangshi-ts-317","yuefu-yf-51"] },
  { wid: "w-poems-xx3-16", title: "九月九日忆山东兄弟", titles: ["九月九日忆山东兄弟"], entries: ["poems-xx3-16","tangshi-ts-254"] },
  { wid: "w-poems-xx3-17", title: "滁州西涧", titles: ["滁州西涧"], entries: ["poems-xx3-17","tangshi-ts-263"] },
  { wid: "w-poems-xx4-04", title: "出塞", titles: ["出塞"], entries: ["poems-xx4-04","tangshi-ts-88","yuefu-yf-30"] },
  { wid: "w-poems-xx4-05", title: "凉州词", titles: ["凉州词"], entries: ["poems-xx4-05","tangshi-ts-258","yuefu-yf-29"] },
  { wid: "w-poems-xx4-12", title: "蜂", titles: ["蜂"], entries: ["poems-xx4-12","tangshi-ts-393"] },
  { wid: "w-poems-xx4-13", title: "独坐敬亭山", titles: ["独坐敬亭山"], entries: ["poems-xx4-13","yuefu-yf-70"] },
  { wid: "w-poems-xx4-17", title: "鹿柴", titles: ["鹿柴"], entries: ["poems-xx4-17","tangshi-ts-222"] },
  { wid: "w-poems-xx4-18", title: "嫦娥", titles: ["嫦娥"], entries: ["poems-xx4-18","tangshi-ts-300"] },
  { wid: "w-poems-xx4-19", title: "竹枝词", titles: ["竹枝词"], entries: ["poems-xx4-19","tangshi-ts-316","yuefu-yf-52"] },
  { wid: "w-poems-xx4-20", title: "芙蓉楼送辛渐", titles: ["芙蓉楼送辛渐"], entries: ["poems-xx4-20","tangshi-ts-255"] },
  { wid: "w-poems-xx4-23", title: "黄鹤楼送孟浩然之广陵", titles: ["黄鹤楼送孟浩然之广陵","送孟浩然之广陵"], entries: ["poems-xx4-23","tangshi-ts-259","yuefu-yf-68"] },
  { wid: "w-poems-xx5-06", title: "山居秋暝", titles: ["山居秋暝"], entries: ["poems-xx5-06","tangshi-ts-121"] },
  { wid: "w-poems-xx5-07", title: "枫桥夜泊", titles: ["枫桥夜泊"], entries: ["poems-xx5-07","tangshi-ts-264"] },
  { wid: "w-poems-xx5-08", title: "长相思", titles: ["长相思","长相思·山一程"], entries: ["poems-xx5-08","songci-sc-296"] },
  { wid: "w-poems-xx5-14", title: "从军行", titles: ["从军行","从军行·其四","从军行七首·其四"], entries: ["poems-xx5-14","tangshi-ts-304","yuefu-yf-31"] },
  { wid: "w-poems-xx5-16", title: "闻官军收河南河北", titles: ["闻官军收河南河北"], entries: ["poems-xx5-16","tangshi-ts-189","yuefu-yf-80"] },
  { wid: "w-poems-xx5-17", title: "渔歌子", titles: ["渔歌子","渔歌子·西塞山前白鹭飞"], entries: ["poems-xx5-17","tangshi-ts-318"] },
  { wid: "w-poems-xx5-21", title: "长歌行", titles: ["长歌行"], entries: ["poems-xx5-21","yuefu-yf-3"] },
  { wid: "w-poems-xx5-23", title: "送元二使安西", titles: ["送元二使安西","渭城曲"], entries: ["poems-xx5-23","tangshi-ts-86"] },
  { wid: "w-poems-xx6-01", title: "宿建德江", titles: ["宿建德江"], entries: ["poems-xx6-01","tangshi-ts-229"] },
  { wid: "w-poems-xx6-03", title: "西江月·夜行黄沙道中", titles: ["西江月·夜行黄沙道中"], entries: ["poems-xx6-03","songci-sc-286"] },
  { wid: "w-poems-xx6-07", title: "回乡偶书", titles: ["回乡偶书","回乡偶书·其一"], entries: ["poems-xx6-07","tangshi-ts-251"] },
  { wid: "w-poems-xx6-08", title: "寒食", titles: ["寒食"], entries: ["poems-xx6-08","tangshi-ts-265"] },
  { wid: "w-poems-xx6-09", title: "迢迢牵牛星", titles: ["迢迢牵牛星"], entries: ["poems-xx6-09","yuefu-yf-103"] },
  { wid: "w-poems-xx6-14", title: "清平乐·春归何处", titles: ["清平乐·春归何处","清平乐"], entries: ["poems-xx6-14","songci-sc-80"] },
  { wid: "w-poems-xx6-17", title: "过故人庄", titles: ["过故人庄"], entries: ["poems-xx6-17","tangshi-ts-132"] },
  { wid: "w-poems-xx6-20", title: "天净沙·秋思", titles: ["天净沙·秋思"], entries: ["poems-xx6-20","yuanqu-yq-1"] },
  { wid: "w-poems-xx6-26", title: "江畔独步寻花（其六）", titles: ["江畔独步寻花（其六）","江畔独步寻花"], entries: ["poems-xx6-26","yuefu-yf-82"] },

  { wid: "w-yuefu-yf-58", title: "相见欢·无言独上西楼", titles: ["相见欢","相见欢·无言独上西楼"], entries: ["songci-sc-290","yuefu-yf-58"] },

  { wid: "w-yuefu-yf-77", title: "春望", titles: ["春望"], entries: ["tangshi-ts-111","yuefu-yf-77"] },
  { wid: "w-tangshi-ts-16", title: "秋登兰山寄张五", titles: ["秋登兰山寄张五","秋登万山寄张五"], entries: ["tangshi-ts-16","tangshi-ts-448"] },
  { wid: "w-tangshi-ts-224", title: "送别", titles: ["送别","山中送别"], entries: ["tangshi-ts-224","tangshi-ts-447"] },
  { wid: "w-yuefu-yf-97", title: "八阵图", titles: ["八阵图"], entries: ["tangshi-ts-233","yuefu-yf-97"] },
  { wid: "w-tangshi-ts-240", title: "新嫁娘", titles: ["新嫁娘","新嫁娘词"], entries: ["tangshi-ts-240","tangshi-ts-406"] },
  { wid: "w-tangshi-ts-246", title: "登乐游原", titles: ["登乐游原","乐游原"], entries: ["tangshi-ts-246","tangshi-ts-412"] },
  { wid: "w-yuefu-yf-53", title: "乌衣巷", titles: ["乌衣巷"], entries: ["tangshi-ts-271","yuefu-yf-53"] },
  { wid: "w-tangshi-ts-279", title: "近试上张水部", titles: ["近试上张水部","近试上张籍水部"], entries: ["tangshi-ts-279","tangshi-ts-373"] },
  { wid: "w-tangshi-ts-283", title: "寄扬州韩绰判官", titles: ["寄扬州韩绰判官"], entries: ["tangshi-ts-283","tangshi-ts-462"] },
  { wid: "w-yuefu-yf-64", title: "秋浦歌十七首·其十五", titles: ["秋浦歌","秋浦歌十七首·其十五"], entries: ["tangshi-ts-303","yuefu-yf-64"] },
  { wid: "w-tangshi-ts-388", title: "题乌江亭", titles: ["题乌江亭"], entries: ["tangshi-ts-388","tangshi-ts-463"] },
  { wid: "w-tangshi-ts-392", title: "南园十三首·其五", titles: ["南园十三首·其五"], entries: ["tangshi-ts-392","tangshi-ts-465"] },
  { wid: "w-yuefu-yf-72", title: "月下独酌", titles: ["月下独酌"], entries: ["tangshi-ts-4","yuefu-yf-72"] },
  { wid: "w-yuefu-yf-81", title: "绝句四首·其三", titles: ["绝句","绝句四首·其三"], entries: ["tangshi-ts-405","yuefu-yf-81"] },
  { wid: "w-tangshi-ts-410", title: "过华清宫绝句·其一", titles: ["过华清宫绝句·其一","过华清宫绝句三首·其一"], entries: ["tangshi-ts-410","tangshi-ts-461"] },
  { wid: "w-yuefu-yf-74", title: "春思", titles: ["春思"], entries: ["tangshi-ts-5","yuefu-yf-74"] },
  { wid: "w-yuefu-yf-42", title: "渔翁", titles: ["渔翁"], entries: ["tangshi-ts-57","yuefu-yf-42"] },
  { wid: "w-yuefu-yf-32", title: "关山月", titles: ["关山月"], entries: ["tangshi-ts-63","yuefu-yf-32"] },
  { wid: "w-yuefu-yf-34", title: "子夜吴歌·秋歌", titles: ["子夜吴歌·秋歌"], entries: ["tangshi-ts-64","yuefu-yf-34"] },
  { wid: "w-yuefu-yf-33", title: "长干行", titles: ["长干行"], entries: ["tangshi-ts-65","yuefu-yf-33"] },
  { wid: "w-yuefu-yf-38", title: "长相思·其一", titles: ["长相思","长相思·其一"], entries: ["tangshi-ts-75","yuefu-yf-38"] },
  { wid: "w-yuefu-yf-46", title: "江南曲", titles: ["江南曲"], entries: ["tangshi-ts-91","yuefu-yf-46"] },
  { wid: "w-yuefu-yf-62", title: "玉阶怨", titles: ["玉阶怨"], entries: ["tangshi-ts-93","yuefu-yf-62"] }
];
/* ==========================================================================
   近重复对（看着像同一篇、**故意不合并**的那些）
   --------------------------------------------------------------------------
   共 1 组，由 scripts/build-works-map.js 与上面那张表一起算出。

   判重键是「正文去标点后逐字相同」。下面这些是**再走一步**才能对上、
   却仍然不该并的两类 ——

   ① 一字之差的两种文本传统（异体 / 通行字）：

     《将进酒》  课内「但愿长醉不愿醒」 vs 唐诗「但愿长醉不复醒」
     《岳阳楼记》古文观止「霪雨霏霏」   vs 课内「淫雨霏霏」
     《天香》    宋词「剪春灯」         vs 宋词「翦春灯」（籀文正体）
     《北山移文》古文观止「比洁」       vs 昭明「比絜」（选本用本字）
     《答苏武书》古文观止「勤勤」       vs 昭明「懃懃」（选本用本字）

   ② 同一篇的两个收录范围（一篇是全文、另一篇是节选）—— 这一类
      连异体字都不用找，差的是一整段：

     《劝学》 课内高一上「教材节选」 vs 《古文》「《荀子》整篇」（Issue #539）

   按本表的规则（课内以教材为准、选集以选本原貌为准、冲突时分两条并列），
   它们**各背各的**。写在同一处，是因为它们最容易被顺手合并：
   正文差不多、题名往往只差一点、搜出来还并排站着。一旦并了，
   学生的课本作「淫雨霏霏」，页面上却成了「霪雨霏霏」—— 不报错，只是变了。

   ⚠️ 这是**生成文件**，改动请改 scripts/build-works-map.js 后重跑。
   字段：entries 条目 id（两条及以上）；reason 为什么不并
   ========================================================================== */
window.WORKS_NEAR_DUP = [
  { entries: ["classic-gw-114", "poems-gz10-10"], reason: "同一篇的两个收录范围：课内那一课是教材节选（止于「锲而不舍，金石可镂」），《古文》那一条是《荀子》整篇全文；教材的节选范围不该被选本覆盖，全文也不该只因为课本里只有节选就不收 —— 并列，各背各的" },
];

