package main

import (
    "net/http"
    "crypto/rand"
    "crypto/subtle"
    "encoding/base64"
    "log"
    "os"
    "time"
    "fmt"
    "os/signal"
    "syscall"
    "context"
    "path/filepath"
    "mime/multipart"
    "strconv"
    "flag"
    "runtime"
    "text/template"
    "strings"

    "github.com/nu7hatch/gouuid"
    "github.com/gin-gonic/gin"
    "github.com/gin-gonic/gin/binding"
    "github.com/gin-contrib/size"
    "github.com/jinzhu/configor"
    "github.com/jinzhu/gorm"
    _ "github.com/jinzhu/gorm/dialects/sqlite"
    // _ "github.com/jinzhu/gorm/dialects/postgres"
    // _ "github.com/jinzhu/gorm/dialects/mysql"
    // _ "github.com/jinzhu/gorm/dialects/mssql"
    "github.com/go-gomail/gomail"
)

const (
    AUTHOR   = "Viktor Liu"
    VERSION  = "0.3.1"
)

const (
    MULTIPART_MEM     = 8 << 20 // 8M
    GRACEFUL_TIMEOUT  = 1 * time.Second
    CONFIG_FILE       = "config.yml"
    OWNER_TOKEN_LEN   = 20
)

type Client struct {
    gorm.Model
    StoredFileId uint
    Addr string
    UserAgent string
    TLSVersion string
    TLSCipherSuite string
}
type DstClient struct {
    Client
}

type StoredFile struct {
    gorm.Model
    FileId     string                `form:"-"        gorm:"not null"`
    OwnerToken string                `form:"-"`
    File       *multipart.FileHeader `form:"file"     gorm:"-"                  binding:"required"`
    Filename   string                `form:"filename" gorm:"type:varchar(1024)" binding:"omitempty,max=1024"`
    Name       string                `form:"-"        gorm:"not null"`
    Email      string                `form:"email"                              binding:"omitempty,email,min=4,max=255"`
    Expiry     uint                  `form:"expiry"   gorm:"default:14"         binding:"omitempty,min=1,max=14"`
    Count      uint                  `form:"count"    gorm:"default:1"          binding:"omitempty,min=1,max=15"`
    SrcClient  *Client               `form:"-"`
    DstClients []DstClient           `form:"-"`
}

type StoredFileInfo struct {
    ExpiryDate time.Time `json:"expiryDate"`
    Count uint  `json:"count"`
    Error string `json:"error"`
}

type FileId struct {
    FileId     string                `json:"fileId" uri:"fileId"                binding:"required,printascii,min=3,max=64"`
}

type OwnerToken struct {
    OwnerToken string                `form:"ownerToken"                         binding:"required,printascii,min=3,max=64"`
}

type OwnedFile struct {
    FileId
    OwnerToken
}

type Stats struct {
    URL string                       `form:"url",    gorm:"not null"            binding:"required,url,max=255"`
    *Client                          `form:"-"`
}

var db *gorm.DB
var flagCleanup *bool
var flagVersion *bool

var Config = struct {
    MaxUploadSize int64  `default:"25"` // MiB
    IDLength      int    `default:"20"`
    StorePath     string `default:"files"`
    ListenAddr    string `default:":8080"`
    TLS struct {
        Use  bool   `default:"false"`
        Key  string `default:"/etc/ssl/private/ssl-cert-snakeoil.key"`
        Cert string `default:"/etc/ssl/certs/ssl-cert-snakeoil.pem"`
    }
    Database struct {
        Driver string `default:"sqlite3"`
        Args   string `default:"gdprshare.db"`
    }
    Mail struct {
        SmtpHost string `default:"localhost"`
        SmtpPort uint16 `default:"25"`
        SmtpUser string
        SmtpPass string
        From     string `default:"root@localhost"`
        Subject  string `default:"File was downloaded: %s"`
        Body     string `default:"File with id {{.FileID}} was downloaded."`
    }
    Header struct {
        TLSVersion     string `default:"X-TLS-Version"`
        TLSCipherSuite string `default:"X-TLS-CipherSuite"`
    }
    SaveClientInfo bool `default:"false"`
    PasswordLength int  `default:"12"`
}{}

func init() {
    // cmdline arg "-version"
    flagVersion = flag.Bool("version", false, "print program version")
    // cmdline arg "-cleanup"
    flagCleanup = flag.Bool("cleanup", false, "start in cleanup mode: remove expired files/entries")
    // cmdline arg "-config"
    config := flag.String("config", CONFIG_FILE, "configuration file path")
    flag.Parse()

    var err error
    if _, err = os.Stat(*config); err != nil {
        log.Fatalf("Cannot open config file: %s", err)
    }

    if err := configor.Load(&Config, *config); err != nil {
        log.Fatalf("Error parsing config file %s: %s", CONFIG_FILE, err)
    }

    // try parsing the mail body template
    template.Must(template.New("mailbody").Parse(Config.Mail.Body))

    if _, err = os.Stat(Config.StorePath); os.IsNotExist(err) {
        // create files directory
        if err = os.Mkdir(Config.StorePath, 0700); err != nil {
            log.Fatalf("Failed to create file store path: %s\n", err)
        }
    }

    db, err = gorm.Open(Config.Database.Driver, Config.Database.Args)
    if err != nil {
        log.Fatalf("Failed to connect to database: %s\n", err)
    }

    if err = db.AutoMigrate(&Client{}).Error; err != nil {
        log.Fatalf("Failed to migrate schema: %s\n", err)
    }

    if err = db.AutoMigrate(&DstClient{}).Error; err != nil {
        log.Fatalf("Failed to migrate schema: %s\n", err)
    }

    if err = db.AutoMigrate(&StoredFile{}).Error; err != nil {
        log.Fatalf("Failed to migrate schema: %s\n", err)
    }

    if err = db.AutoMigrate(&Stats{}).Error; err != nil {
        log.Fatalf("Failed to migrate schema: %s\n", err)
    }

}

func main() {
    if *flagCleanup {
        if errors := cleanup(); len(errors) > 0 {
            log.Println("File cleanup errors:")
            for _, err := range errors {
                log.Printf("%s\n", err)
            }
            os.Exit(len(errors))
        }
        os.Exit(0)
    } else if *flagVersion {
        version()
        os.Exit(0)
    }

    // override v8 validator with v10
    binding.Validator = new(defaultValidator)
    router := gin.Default()

    // TODO: add json response
    router.Use(limits.RequestSizeLimiter(Config.MaxUploadSize * 1024  * 1024))
    router.MaxMultipartMemory = MULTIPART_MEM

    router.Static("/assets", "public")

    router.GET("/", index)
    router.GET("/uploaded", index)
    router.GET("/d/:fileId", index)

    v1 := router.Group("/api/v1")
    v1.POST("/stats", setStats)
    v1.GET("/config", getConfig)
    v1.POST("/files", uploadFile)
    v1.GET("/files/:fileId", downloadFile)
    v1.DELETE("/files/:fileId", deleteFile)
    v1.POST("/files/validate", validateFiles)

    srv := &http.Server{
        Addr:    Config.ListenAddr,
        Handler: router,
    }

    go func() {
        var err error

        if (Config.TLS.Use) {
            err = srv.ListenAndServeTLS(Config.TLS.Cert, Config.TLS.Key)
        } else {
            err = srv.ListenAndServe()
        }

        if err != nil && err != http.ErrServerClosed {
            log.Fatalf("Failed to start server: %s\n", err)
        }
    }()

    sig := make(chan os.Signal)

    signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)

    <-sig

    log.Println("Server shutdown ...")

    ctx, cancel := context.WithTimeout(context.Background(), GRACEFUL_TIMEOUT)
    defer cancel()
    if err := srv.Shutdown(ctx); err != nil {
        log.Fatalln(err)
    }

    select {
    case <-ctx.Done():
    }
    log.Println("Finished")

}

func genToken(length int) (string, error) {
    buf := make([]byte, length)

    _, err := rand.Read(buf)
    if err != nil {
        return "", err
    }

    token := base64.RawURLEncoding.EncodeToString(buf)

    return token, nil
}

func index(c *gin.Context) {
    c.File("public/index.html")
}

func getConfig(c *gin.Context) {
    c.JSON(
        http.StatusOK,
        gin.H{
            "maxFileSize": Config.MaxUploadSize,
            "passwordLength": Config.PasswordLength,
        },
    )
}

func uploadFile(c *gin.Context) {
    var storedFile StoredFile
    if err := c.ShouldBind(&storedFile); err != nil {
        // file too large: middleware has already written to response body
        if c.Writer.Status() == http.StatusRequestEntityTooLarge {
            return
        }
        c.JSON(
            http.StatusBadRequest,
            gin.H{
                "message": err.Error(),
            },
        )
        return
    }

    name, err := uuid.NewV4()
    if err != nil {
        log.Printf("Failed to create uuid: %s", err)
        c.JSON(
            http.StatusInternalServerError,
            gin.H{
                "message": "failed to generate temp filename",
            },
        )
        return
    }
    namestr := name.String()

    fileId, err := genToken(Config.IDLength)
    if err != nil {
        log.Printf("Failed to generate file ID: %s", err)
        c.JSON(
            http.StatusInternalServerError,
            gin.H{
                "message": "failed to generate file ID",
            },
        )
        return
    }

    ownerToken, err := genToken(OWNER_TOKEN_LEN)
    if err != nil {
        log.Printf("Failed to generate file ID: %s", err)
        c.JSON(
            http.StatusInternalServerError,
            gin.H{
                "message": "failed to generate owner token",
            },
        )
        return
    }


    tx := db.Begin()
    if err = tx.Error; err != nil {
        log.Printf("Failed to begin transaction: %s", err)
        c.JSON(
            http.StatusInternalServerError,
            gin.H{
                "message": "failed to start transaction",
            },
        )
        return
    }

    storedFile.FileId = fileId
    storedFile.OwnerToken = ownerToken
    storedFile.Name = namestr

    storedFile.SrcClient = getClientInfo(c)

    if err = tx.Create(&storedFile).Error; err != nil {
        log.Printf("Failed to create file in database: %s", err)
        if err = tx.Rollback().Error; err != nil {
            log.Printf("Failed to rollback: %s", err)
        }
        c.JSON(
            http.StatusInternalServerError,
            gin.H{
                "message": "failed to store file in database",
            },
        )
        return
    }



    path := filepath.Join(Config.StorePath, namestr)
    if err := c.SaveUploadedFile(storedFile.File, path); err != nil {
        log.Printf("Failed to save file: %s", err)
        if err = tx.Rollback().Error; err != nil {
            log.Printf("Failed to rollback: %s", err)
        }
        c.JSON(
            http.StatusInternalServerError,
            gin.H{
                "message": "failed to save file",
            },
        )
        return
    }

    if err = tx.Commit().Error; err != nil {
        log.Printf("Failed to commit: %s", err)

        if err = os.Remove(path); err != nil {
            log.Printf("Failed to remove file %s: %s", path, err)
        }
        c.JSON(
            http.StatusInternalServerError,
            gin.H{
                "message": "failed to store file in database",
            },
        )
        return
    }

    c.Header("Location", "/d/" + fileId)
    c.JSON(
        http.StatusCreated,
        gin.H{
            "message": "file uploaded successfully",
            "fileId": fileId,
            "ownerToken": ownerToken,
        },
    )
}

func validateFiles(c *gin.Context) {
    var files []OwnedFile
    if err := c.ShouldBindJSON(&files); err != nil {
        // TODO: get FieldError and return relevant part only
        c.JSON(
            http.StatusBadRequest,
            gin.H{
                "message": err.Error(),
            },
        )
        return
    }


    log.Println("%+#v", files)
    fileInfo := map[string]StoredFileInfo{}
    for _, f := range(files) {
        var storedFile StoredFile

        fileId := f.FileId.FileId
        err := db.Where(&StoredFile{FileId: fileId}).Find(&storedFile).Error;
        if err != nil {
            log.Printf("Failed to find file with id %s in database: %s\n", fileId, err)
            fileInfo[fileId] = StoredFileInfo{}
        } else if subtle.ConstantTimeCompare([]byte(f.OwnerToken.OwnerToken), []byte(storedFile.OwnerToken)) != 1 {
            fileInfo[fileId] = StoredFileInfo{
                Error: "Owner token mismatch",
            }
        } else {
            fileInfo[fileId] = StoredFileInfo{
                ExpiryDate: storedFile.CreatedAt.AddDate(0, 0, int(storedFile.Expiry)),
                Count: storedFile.Count,
            }
        }
    }

    c.JSON(
        http.StatusOK,
        gin.H{
            "fileInfo": fileInfo,
        },
    )
}

func downloadFile(c *gin.Context) {
    var f FileId
    if err := c.ShouldBindUri(&f); err != nil {
        // TODO: get FieldError and return relevant part only
        c.JSON(
            http.StatusBadRequest,
            gin.H{
                "message": err.Error(),
            },
        )
        return
    }
    fileId := f.FileId

    var storedFile StoredFile
    if err := db.Where(&StoredFile{FileId: fileId}).Find(&storedFile).Error; err != nil {
        log.Printf("Failed to find file with id %s in database: %s\n", fileId, err)
        c.JSON(
            http.StatusNotFound,
            gin.H{
                "message": "file not found or download limit exceeded",
            },
        )
        return
    }

    var srcclient Client
    if err:= db.Model(&storedFile).Related(&srcclient).Error; err != nil {
        log.Printf("Failed to access src client of file with id %s in database: %s\n", fileId, err)
        c.JSON(
            http.StatusNotFound,
            gin.H{
                "message": "file retrieval error",
            },
        )
        return
    }
    storedFile.SrcClient = &srcclient

    var dstclients []DstClient
    if err:= db.Model(&storedFile).Related(&dstclients).Error; err != nil {
        log.Printf("Failed to access dst clients of file with id %s in database: %s\n", fileId, err)
        c.JSON(
            http.StatusNotFound,
            gin.H{
                "message": "file retrieval error",
            },
        )
        return
    }
    storedFile.DstClients = dstclients

    path := filepath.Join(Config.StorePath, storedFile.Name)

    if storedFile.Count < 1 {
        if errs := deleteStoredFile(&storedFile); len(errs) > 0 {
            for _, err := range errs {
                log.Printf("%s\n", err)
            }
        }
        c.JSON(
            http.StatusNotFound,
            gin.H{
                "message": "download count expired",
            },
        )
        return
    }


    if info, err := os.Stat(path); err != nil || info.IsDir() {
        if err != nil {
            log.Printf("Failed to access file with id %s: %s\n", fileId, err)
        } else {
            log.Printf("File with id %s is a directory\n", fileId)
        }

        if err = db.Delete(&storedFile).Error; err != nil {
            log.Printf("Failed to delete file with id %s from database: %s\n", fileId, err)
        }

        c.JSON(
            http.StatusNotFound,
            gin.H{
                "message": "file not found",
            },
        )
        return
    }

    client := DstClient{*getClientInfo(c)}
    storedFile.DstClients = append(
        storedFile.DstClients,
        client,
    )
    storedFile.Count--
    if err := db.Save(&storedFile).Error; err != nil {
        log.Printf("Failed to save decreased count on file with id %s: %s\n", fileId, err)
    }

    var filename string
    if storedFile.Filename != "" {
        filename = storedFile.Filename
    } else {
        filename = storedFile.Name
    }
    c.Header("X-Filename", filename)
    c.FileAttachment(path, filename)

    if storedFile.Count < 1 {
        if err := db.Delete(&storedFile).Error; err != nil {
            log.Printf("Failed to delete file with id %s from database: %s\n", fileId, err)
        }
        if err := os.Remove(path); err != nil {
            log.Printf("Failed to delete file with id %s from storage: %s\n", fileId, err)
        }
    }

    if storedFile.Email != "" {
        templ, err := template.New("mailbody").Parse(Config.Mail.Body)
        if err != nil {
            log.Printf("Failed to parse mail body template: %s", err)
            return
        }

        fields := map[string]string{
            "FileID":            storedFile.FileId,
            "Addr":              client.Addr,
            "UserAgent":         client.UserAgent,
            "SrcTLSVersion":     storedFile.SrcClient.TLSVersion,
            "SrcTLSCipherSuite": storedFile.SrcClient.TLSCipherSuite,
            "DstTLSVersion":     client.TLSVersion,
            "DstTLSCipherSuite": client.TLSCipherSuite,
        }
        var body strings.Builder
        if err := templ.Execute(&body, fields); err != nil {
            log.Printf("Failed to execute mail body template: %s", err)
            return
        }

        msg := gomail.NewMessage()
        msg.SetHeader("From", Config.Mail.From)
        msg.SetHeader("To", storedFile.Email)
        msg.SetHeader(
            "Subject",
            fmt.Sprintf(
                Config.Mail.Subject,
                fileId,
            ),
        )
        msg.SetBody("text/plain", body.String())

        dialer := gomail.NewDialer(Config.Mail.SmtpHost, int(Config.Mail.SmtpPort), Config.Mail.SmtpUser, Config.Mail.SmtpPass)

        if err := dialer.DialAndSend(msg); err != nil {
            log.Printf("Failed to send mail for file with id %s to %s: %s\n", storedFile.FileId, storedFile.Email, err)
        }
    }
}

func deleteFile(c *gin.Context) {
    var f FileId
    if err := c.ShouldBindUri(&f); err != nil {
        // TODO: get FieldError and return relevant part only
        c.JSON(
            http.StatusBadRequest,
            gin.H{
                "message": err.Error(),
            },
        )
        return
    }
    var o OwnerToken
    if err := c.ShouldBind(&o); err != nil {
        // TODO: get FieldError and return relevant part only
        c.JSON(
            http.StatusBadRequest,
            gin.H{
                "message": err.Error(),
            },
        )
        return
    }

    fileId := f.FileId

    var storedFile StoredFile
    if err := db.Where(&StoredFile{FileId: fileId}).Find(&storedFile).Error; err != nil {
        log.Printf("Failed to find file with id %s in database: %s\n", fileId, err)
        c.JSON(
            http.StatusNotFound,
            gin.H{
                "message": "file not found",
            },
        )
        return
    }

    // check if owner token matches the stored one
    if subtle.ConstantTimeCompare([]byte(o.OwnerToken), []byte(storedFile.OwnerToken)) != 1 {
        c.JSON(
            http.StatusUnauthorized,
            gin.H{
                "message": "owner token doesn't match",
            },
        )
        return
    }

    if errs := deleteStoredFile(&storedFile); len(errs) > 0 {
        for _, err := range errs {
            log.Printf("%s\n", err)
        }
        c.JSON(
            http.StatusInternalServerError,
            gin.H{
                "message": "file deletion failed",
            },
        )
        return
    }

    c.JSON(
        http.StatusOK,
        gin.H{
            "message": "file deleted",
        },
    )
}

func setStats(c *gin.Context) {
    var stats Stats
    if err := c.ShouldBind(&stats); err != nil {
        // TODO: get FieldError and return relevant part only
        c.JSON(
            http.StatusBadRequest,
            gin.H{
                "message": err.Error(),
            },
        )
        return
    }

    if Config.SaveClientInfo {
        stats.Client = getClientInfo(c)
    }
    if err := db.Save(&stats).Error; err != nil {
        log.Printf("Failed to store stats: %s", err)
        c.JSON(
            http.StatusInternalServerError,
            gin.H{
                "message": "failed to store stats",
            },
        )
        return
    }

    c.JSON(
        http.StatusOK,
        gin.H{
            "message": "stats saved",
        },
    )
}

func deleteStoredFile(f *StoredFile) []error {
    var errors []error

    path := filepath.Join(Config.StorePath, f.Name)
    if err := os.Remove(path); err != nil {
        errors = append(errors, fmt.Errorf("Failed to delete file with id %s from storage: %s", f.FileId, err))
    }
    if err := db.Delete(&f).Error; err != nil {
        errors = append(errors, fmt.Errorf("Failed to delete file with id %s from database: %s", f.FileId, err))
    }

    return errors
}

func cleanup() []error {
    var expired []StoredFile
    var errors []error

    if errs := db.Where("datetime(created_at, expiry || ' days') > datetime('now')").Find(&expired).GetErrors(); errs != nil {
        for _, err := range errs {
            if !gorm.IsRecordNotFoundError(err) {
                errors = append(errors, err)
            }
        }
    }

    for _, v := range expired {
        if errs := deleteStoredFile(&v); len(errs) > 0 {
            errors = append(errors, errs...)
        }
    }

    return errors
}

func version() {
    fmt.Printf("%s version: %s\ngo version: %s %s/%s\n", os.Args[0], VERSION, runtime.Version(), runtime.GOOS, runtime.GOARCH)
}

func getClientInfo(c *gin.Context) *Client {
    var addr, ua, tlsversion, tlscipher string
    if Config.SaveClientInfo {
        addr = c.ClientIP()
        ua = c.Request.Header.Get("User-Agent")
    } else {
        ua = "none"
    }

    if c.Request.TLS != nil {
        tlscipher = strconv.Itoa(int(c.Request.TLS.CipherSuite))
        tlsversion = strconv.Itoa(int(c.Request.TLS.Version))
    } else {
        tlsversion = c.Request.Header.Get(Config.Header.TLSVersion)
        tlscipher = c.Request.Header.Get(Config.Header.TLSCipherSuite)
    }

    return &Client{
        Addr: addr,
        UserAgent: ua,
        TLSVersion: tlsversion,
        TLSCipherSuite: tlscipher,
    }
}
