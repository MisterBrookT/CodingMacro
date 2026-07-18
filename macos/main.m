#import <ApplicationServices/ApplicationServices.h>
#import <Cocoa/Cocoa.h>

static NSString *const DashboardURL = @"http://127.0.0.1:48762/dashboard";
static NSString *const HealthURL = @"http://127.0.0.1:48762/health";

@interface AppDelegate : NSObject <NSApplicationDelegate>
@property(nonatomic, strong) NSStatusItem *statusItem;
@property(nonatomic, strong) NSMenuItem *statusMenuItem;
@property(nonatomic, strong) NSMenuItem *startMenuItem;
@property(nonatomic, strong) NSMenuItem *simulateMenuItem;
@property(nonatomic, strong) NSMenuItem *stopMenuItem;
@property(nonatomic, strong) NSTask *task;
@property(nonatomic, strong) NSTimer *healthTimer;
@end

@implementation AppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
  (void)notification;
  [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];

  self.statusItem = [[NSStatusBar systemStatusBar] statusItemWithLength:NSVariableStatusItemLength];
  self.statusItem.button.title = @"CM";
  self.statusItem.button.toolTip = @"CodingMacro";

  NSMenu *menu = [[NSMenu alloc] init];
  self.statusMenuItem = [self addItem:@"Stopped" action:nil menu:menu];
  self.statusMenuItem.enabled = NO;
  [menu addItem:[NSMenuItem separatorItem]];

  self.startMenuItem = [self addItem:@"Start Codex App" action:@selector(startCodex:) menu:menu];
  self.simulateMenuItem =
      [self addItem:@"Start Simulator" action:@selector(startSimulator:) menu:menu];
  [self addItem:@"Open Dashboard" action:@selector(openDashboard:) menu:menu];
  [menu addItem:[NSMenuItem separatorItem]];
  [self addItem:@"Enable Accessibility…" action:@selector(requestAccessibility:) menu:menu];
  [self addItem:@"Run Controller Doctor…" action:@selector(runDoctor:) menu:menu];
  [self addItem:@"Open Logs" action:@selector(openLogs:) menu:menu];
  self.stopMenuItem = [self addItem:@"Stop" action:@selector(stop:) menu:menu];
  self.stopMenuItem.enabled = NO;
  [menu addItem:[NSMenuItem separatorItem]];
  [self addItem:@"Quit CodingMacro" action:@selector(quit:) menu:menu];

  self.statusItem.menu = menu;
  self.healthTimer = [NSTimer scheduledTimerWithTimeInterval:1.5
                                                      target:self
                                                    selector:@selector(checkHealth:)
                                                    userInfo:nil
                                                     repeats:YES];
  [self checkHealth:nil];
}

- (NSMenuItem *)addItem:(NSString *)title action:(SEL)action menu:(NSMenu *)menu {
  NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:title action:action keyEquivalent:@""];
  item.target = self;
  [menu addItem:item];
  return item;
}

- (NSString *)codingMacroBinary {
  NSString *override = NSProcessInfo.processInfo.environment[@"CODINGMACRO_BIN"];
  if (override.length > 0 && [[NSFileManager defaultManager] isExecutableFileAtPath:override])
    return override;

  NSString *pathFile =
      [[NSHomeDirectory() stringByAppendingPathComponent:@".codingmacro"]
          stringByAppendingPathComponent:@"cli-path"];
  NSString *saved = [NSString stringWithContentsOfFile:pathFile
                                               encoding:NSUTF8StringEncoding
                                                  error:nil];
  saved = [saved stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if (saved.length > 0 && [[NSFileManager defaultManager] isExecutableFileAtPath:saved]) return saved;

  NSArray<NSString *> *paths = @[
    @"/opt/homebrew/bin/codingmacro",
    @"/usr/local/bin/codingmacro",
    [NSHomeDirectory() stringByAppendingPathComponent:@".npm-global/bin/codingmacro"],
    [NSHomeDirectory() stringByAppendingPathComponent:@".local/bin/codingmacro"]
  ];
  for (NSString *path in paths) {
    if ([[NSFileManager defaultManager] isExecutableFileAtPath:path]) return path;
  }
  return nil;
}

- (void)startCodex:(id)sender {
  (void)sender;
  [self startWithArguments:@[ @"--dashboard", @"codex-app" ]];
}

- (void)startSimulator:(id)sender {
  (void)sender;
  [self startWithArguments:@[ @"--simulate", @"codex-app" ]];
}

- (void)startWithArguments:(NSArray<NSString *> *)arguments {
  if (self.task.running) {
    [self openDashboard:nil];
    return;
  }

  NSString *binary = [self codingMacroBinary];
  if (!binary) {
    [self showAlert:@"CodingMacro CLI not found"
              text:@"Run the installer from github.com/MisterBrookT/CodingMacro, then reopen the app."];
    return;
  }

  NSString *logDir = [NSHomeDirectory() stringByAppendingPathComponent:@".codingmacro"];
  [[NSFileManager defaultManager] createDirectoryAtPath:logDir
                            withIntermediateDirectories:YES
                                             attributes:nil
                                                  error:nil];
  NSString *logPath = [logDir stringByAppendingPathComponent:@"menubar.log"];
  if (![[NSFileManager defaultManager] fileExistsAtPath:logPath])
    [[NSFileManager defaultManager] createFileAtPath:logPath contents:nil attributes:nil];
  NSFileHandle *log = [NSFileHandle fileHandleForWritingAtPath:logPath];
  [log seekToEndOfFile];

  NSTask *task = [[NSTask alloc] init];
  task.executableURL = [NSURL fileURLWithPath:binary];
  task.arguments = arguments;
  task.currentDirectoryURL = [NSURL fileURLWithPath:NSHomeDirectory()];
  task.standardOutput = log;
  task.standardError = log;
  __weak typeof(self) weakSelf = self;
  task.terminationHandler = ^(NSTask *finished) {
    (void)finished;
    dispatch_async(dispatch_get_main_queue(), ^{
      weakSelf.task = nil;
      [weakSelf updateRunning:NO simulation:NO];
    });
  };

  NSError *error = nil;
  if (![task launchAndReturnError:&error]) {
    [self showAlert:@"Could not start CodingMacro" text:error.localizedDescription];
    return;
  }
  self.task = task;
  [self updateRunning:YES simulation:[arguments containsObject:@"--simulate"]];
}

- (void)openDashboard:(id)sender {
  (void)sender;
  [[NSWorkspace sharedWorkspace] openURL:[NSURL URLWithString:DashboardURL]];
}

- (void)requestAccessibility:(id)sender {
  (void)sender;
  NSDictionary *options = @{(__bridge NSString *)kAXTrustedCheckOptionPrompt : @YES};
  AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)options);
}

- (void)runDoctor:(id)sender {
  (void)sender;
  NSString *binary = [self codingMacroBinary];
  if (!binary) {
    [self showAlert:@"CodingMacro CLI not found" text:@"Install the CLI first."];
    return;
  }
  NSString *escaped = [binary stringByReplacingOccurrencesOfString:@"'" withString:@"'\\''"];
  NSString *command = [NSString stringWithFormat:@"'%@' doctor", escaped];
  NSString *source = [NSString
      stringWithFormat:@"tell application \"Terminal\"\nactivate\ndo script \"%@\"\nend tell",
                       [command stringByReplacingOccurrencesOfString:@"\"" withString:@"\\\""]];
  NSAppleScript *script = [[NSAppleScript alloc] initWithSource:source];
  NSDictionary *error = nil;
  [script executeAndReturnError:&error];
  if (error) [self showAlert:@"Could not open Terminal" text:error.description];
}

- (void)openLogs:(id)sender {
  (void)sender;
  NSString *logPath =
      [[NSHomeDirectory() stringByAppendingPathComponent:@".codingmacro"]
          stringByAppendingPathComponent:@"menubar.log"];
  if (![[NSFileManager defaultManager] fileExistsAtPath:logPath])
    [[NSFileManager defaultManager] createFileAtPath:logPath contents:nil attributes:nil];
  [[NSWorkspace sharedWorkspace] openURL:[NSURL fileURLWithPath:logPath]];
}

- (void)stop:(id)sender {
  (void)sender;
  if (self.task.running) [self.task terminate];
}

- (void)quit:(id)sender {
  (void)sender;
  if (self.task.running) [self.task terminate];
  [NSApp terminate:nil];
}

- (void)checkHealth:(NSTimer *)timer {
  (void)timer;
  NSMutableURLRequest *request =
      [NSMutableURLRequest requestWithURL:[NSURL URLWithString:HealthURL]];
  request.timeoutInterval = 1.0;
  [[[NSURLSession sharedSession]
      dataTaskWithRequest:request
        completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
          BOOL running = data != nil && error == nil &&
                         [(NSHTTPURLResponse *)response statusCode] == 200;
          BOOL simulation = running &&
                            [data rangeOfData:[@"\"simulation\":true" dataUsingEncoding:NSUTF8StringEncoding]
                                      options:0
                                        range:NSMakeRange(0, data.length)]
                                    .location != NSNotFound;
          dispatch_async(dispatch_get_main_queue(), ^{
            [self updateRunning:running simulation:simulation];
          });
        }] resume];
}

- (void)updateRunning:(BOOL)running simulation:(BOOL)simulation {
  self.statusMenuItem.title = running ? (simulation ? @"Running · Simulator" : @"Running · Controller")
                                      : @"Stopped";
  self.statusItem.button.toolTip = self.statusMenuItem.title;
  self.startMenuItem.enabled = !running;
  self.simulateMenuItem.enabled = !running;
  self.stopMenuItem.enabled = self.task.running;
}

- (void)showAlert:(NSString *)title text:(NSString *)text {
  [NSApp activateIgnoringOtherApps:YES];
  NSAlert *alert = [[NSAlert alloc] init];
  alert.messageText = title;
  alert.informativeText = text ?: @"";
  [alert addButtonWithTitle:@"OK"];
  [alert runModal];
}

- (void)applicationWillTerminate:(NSNotification *)notification {
  (void)notification;
  [self.healthTimer invalidate];
  if (self.task.running) [self.task terminate];
}

@end

int main(int argc, const char *argv[]) {
  (void)argc;
  (void)argv;
  @autoreleasepool {
    NSApplication *app = [NSApplication sharedApplication];
    AppDelegate *delegate = [[AppDelegate alloc] init];
    app.delegate = delegate;
    [app run];
  }
  return 0;
}
